import { Request, Response } from 'express';
import os from 'os';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { supabaseAdmin } from '../lib/supabase.js';
import { prisma } from '../lib/prisma.js';


export const createUser = async (req: Request, res: Response) => {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
        return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ message: 'Role must be admin or user' });
    }

    try {
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if (authError) {
            return res.status(400).json({ message: authError.message });
        }

        if (!authData.user) {
            return res.status(500).json({ message: 'Failed to create user' });
        }

        const profile = await prisma.profile.create({
            data: {
                user_id: authData.user.id,
                email: authData.user.email!,
                role,
            },
        });


        return res.status(201).json({
            id: authData.user.id,
            email: profile.email,
            role: profile.role,
        });
    } catch (err: any) {
        console.error('Create user error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAllUsers = async (_req: Request, res: Response) => {
    try {
        // Fetch all auth users (Supabase default page size is 50; loop if you have more)
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
        if (authError) throw authError;

        // Fetch all profiles for role lookup
        const profiles = await prisma.profile.findMany();
        const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

        const users = authData.users.map((user) => {
            const profile = profileMap.get(user.id);
            return {
                id: user.id,
                email: user.email,
                role: profile?.role || 'user',
                created_at: user.created_at,
                last_sign_in_at: user.last_sign_in_at,
                profile_id: profile?.id || null,
            };
        });

        res.json(users);
    } catch (err: any) {
        console.error('Get all users error:', err);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    const { id } = req.params as { id: string }; // auth.users.id
    const { role, password } = req.body;

    if (!role && !password) {
        return res.status(400).json({ message: 'Provide role or password to update' });
    }

    if (role && !['admin', 'user', 'super_admin'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
    }

    try {
        // 1. Update password in Supabase Auth if provided
        if (password) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, {
                password,
            });
            if (authError) {
                return res.status(400).json({ message: authError.message });
            }
        }

        // 2. Update role in Profile table if provided
        let updatedProfile = null;
        if (role) {
            updatedProfile = await prisma.profile.update({
                where: { user_id: id },
                data: { role },
            });
        }

        // 3. Fetch current state to return
        const currentProfile = updatedProfile || await prisma.profile.findUnique({
            where: { user_id: id },
        });

        if (!currentProfile) {
            return res.status(404).json({ message: 'User profile not found' });
        }

        res.json({
            id,
            email: currentProfile.email,
            role: currentProfile.role,
            password_updated: !!password,
        });
    } catch (err: any) {
        if (err.code === 'P2025') {
            return res.status(404).json({ message: 'User profile not found' });
        }
        console.error('Update user error:', err);
        res.status(500).json({ message: 'Failed to update user' });
    }
};

export const deleteUser = async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };

    try {
        // 1. Delete Profile FIRST — this blocks their JWT immediately in authenticate middleware
        await prisma.profile.deleteMany({
            where: { user_id: id },
        });

        // 2. Delete from Supabase Auth — revokes refresh tokens, prevents new logins
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);

        if (authError) {
            return res.status(400).json({ message: authError.message });
        }

        return res.json({ message: 'User deleted and logged out from all sessions' });
    } catch (err: any) {
        console.error('Delete user error:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const backup = (req: Request, res: Response) => {
    const dbUrl = process.env.DIRECT_URL;
    const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';

    if (!dbUrl) {
        return res.status(500).json({ message: 'DATABASE_URL not configured' });
    }

    const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const pgDump = spawn(pgDumpPath, [
        '--format=custom',
        '--no-acl',
        '--no-owner',
        '--table=public.categories',
        '--table=public.products',
        // '--table=public.profiles',
        '--table=public.stock_history',
        dbUrl,
    ]);

    pgDump.stdout.pipe(res);

    pgDump.stderr.on('data', (data) => {
        console.error(`pg_dump stderr: ${data}`);
    });

    pgDump.on('error', (err) => {
        console.error('pg_dump error:', err);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Backup failed to start' });
        } else {
            res.destroy();
        }
    });

    pgDump.on('close', (code) => {
        if (code !== 0) {
            console.error(`pg_dump exited with code ${code}`);
        }
        if (!res.writableEnded) {
            res.end();
        }
    });
};


export const restore = async (req: Request, res: Response) => {
    const dbUrl = process.env.DIRECT_URL;
    const pgRestorePath = process.env.PG_RESTORE_PATH || 'pg_restore';
    const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';
    const safetyDir = process.env.SAFETY_SNAPSHOT_DIR || './safety_snapshots';

    if (!dbUrl) {
        return res.status(500).json({ message: 'DATABASE_URL not configured' });
    }

    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    const tempPath = req.file.path;

    try {
        // 1. Validate magic bytes for .dump files
        if (req.file.originalname.toLowerCase().endsWith('.dump')) {
            const fd = await fs.open(tempPath, 'r');
            const buffer = Buffer.alloc(4);
            await fd.read(buffer, 0, 4, 0);
            await fd.close();

            // PGDM = 0x50 0x47 0x44 0x4D
            if (buffer.toString('hex') !== '5047444d') {
                await fs.unlink(tempPath).catch(() => { });
                return res.status(400).json({ message: 'Invalid PostgreSQL custom dump format' });
            }
        }

        // 2. Ensure safety directory exists
        await fs.mkdir(safetyDir, { recursive: true });

        // 3. Take safety snapshot
        const timestamp = Date.now();
        const safetyPath = path.join(safetyDir, `safety_snapshot_${timestamp}.dump`);

        await new Promise<void>((resolve, reject) => {
            const safetyDump = spawn(pgDumpPath, [
                '--format=custom',
                '--no-acl',
                '--no-owner',
                '--table=public.categories',
                '--table=public.products',
                // '--table=public.profiles',
                '--table=public.stock_history',
                dbUrl,
            ]);

            const writeStream = createWriteStream(safetyPath);

            let errorOutput = '';

            safetyDump.stdout.pipe(writeStream);

            safetyDump.stderr.on('data', (data: Buffer) => {
                errorOutput += data.toString();

                console.error(
                    `Safety snapshot stderr: ${data.toString()}`
                );
            });

            safetyDump.on('error', (err) => {
                writeStream.destroy();
                reject(err);
            });

            writeStream.on('error', (err) => {
                reject(err);
            });

            safetyDump.on('close', (code) => {
                if (code === 0) {
                    writeStream.end(() => {
                        resolve();
                    });
                } else {
                    writeStream.destroy();

                    reject(
                        new Error(
                            `Safety snapshot failed with code ${code}: ${errorOutput || 'Unknown pg_dump error'
                            }`
                        )
                    );
                }
            });
        });

        // 4. Restore from uploaded file
        const restoreResult = await runPgRestore(pgRestorePath, dbUrl, tempPath);

        // Clean up uploaded temp file
        await fs.unlink(tempPath).catch(() => { });

        if (restoreResult.success) {
            return res.json({
                message: 'Restore completed successfully',
                snapshotPath: safetyPath,
            });
        }

        // 5. Restore failed — attempt rollback
        console.error('Restore failed, attempting rollback from safety snapshot...');
        const rollbackResult = await runPgRestore(pgRestorePath, dbUrl, safetyPath);

        if (rollbackResult.success) {
            return res.status(500).json({
                message: 'Restore failed. Database rolled back to safety snapshot.',
                error: restoreResult.error,
                snapshotPath: safetyPath,
            });
        }

        return res.status(500).json({
            message: 'Restore failed and rollback also failed.',
            error: restoreResult.error,
            rollbackError: rollbackResult.error,
            snapshotPath: safetyPath,
        });
    } catch (err: any) {
        await fs.unlink(tempPath).catch(() => { });
        console.error('Restore error:', err);
        return res.status(500).json({ message: 'Restore failed', error: err.message });
    }
};

// Helper: run pg_restore and capture result
function runPgRestore(
    pgRestorePath: string,
    dbUrl: string,
    filePath: string
): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        const pgRestore = spawn(pgRestorePath, [
            '--clean',
            '--if-exists',
            '--no-owner',
            '--no-acl',
            `--dbname=${dbUrl}`,
            filePath,
        ]);

        let errorOutput = '';

        pgRestore.stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();

            console.error(
                `pg_restore stderr: ${data.toString()}`
            );
        });

        pgRestore.on('error', (err) => {
            resolve({
                success: false,
                error: err.message,
            });
        });

        pgRestore.on('close', (code) => {
            console.log(`pg_restore exited with code: ${code}`);

            if (code === 0) {
                resolve({
                    success: true,
                });
            } else {
                resolve({
                    success: false,
                    error:
                        errorOutput ||
                        `pg_restore exited with code ${code}`,
                });
            }
        });
    });
}