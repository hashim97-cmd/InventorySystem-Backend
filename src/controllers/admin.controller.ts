import { Request, Response } from 'express';
import os from 'os';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { supabaseAdmin } from '../lib/supabase.js';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';



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
            const duplicateEmail = authError.code === 'email_exists'
                || /already registered|already exists/i.test(authError.message);
            if (!duplicateEmail) {
                return res.status(400).json({ message: authError.message });
            }

            const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
            const existingUser = usersData.users.find(item => item.email?.toLowerCase() === String(email).toLowerCase());
            if (usersError || !existingUser) {
                return res.status(409).json({ message: 'A user with this email already exists' });
            }

            const existingProfile = await prisma.profile.findUnique({ where: { user_id: existingUser.id } });
            if (existingProfile) {
                return res.status(409).json({ message: 'A user with this email already exists' });
            }

            const recoveredProfile = await prisma.profile.create({
                data: { user_id: existingUser.id, email: existingUser.email || email, role },
            });
            return res.status(201).json({ id: existingUser.id, email: recoveredProfile.email, role: recoveredProfile.role });
        }

        if (!authData.user) {
            return res.status(500).json({ message: 'Failed to create user' });
        }

        const profile = await prisma.profile.upsert({
            where: { user_id: authData.user.id },
            create: {
                user_id: authData.user.id,
                email: authData.user.email || email,
                role,
            },
            update: {
                email: authData.user.email || email,
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
        if (err?.code === 'P2002') {
            return res.status(409).json({ message: 'A user with this email already exists' });
        }
        if (err?.code === 'P2023') {
            return res.status(400).json({ message: 'Invalid user identifier' });
        }
        return res.status(500).json({ message: 'Failed to create user', details: err?.message });
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


// ═══════════════════════════════════════════════════════════════
// JSON BACKUP / RESTORE (shared hosting compatible)
// ═══════════════════════════════════════════════════════════════


const normalizeCat = (raw: any) => ({
    id: raw.id,
    name: raw.name,
    parentId: raw.parentId ?? raw.parent_id ?? null,
    sortOrder: raw.sortOrder ?? raw.sort_order ?? 0,
    createdAt: raw.createdAt ?? raw.created_at ? new Date(raw.createdAt ?? raw.created_at) : undefined,
});

const normalizeProd = (raw: any) => ({
    id: raw.id,
    name: raw.name,
    code: raw.code,
    categoryId: raw.categoryId ?? raw.category_id ?? null,
    quantity: raw.quantity ?? 0,
    lengthCm: raw.lengthCm ?? raw.length_cm != null ? parseFloat(String(raw.lengthCm ?? raw.length_cm)) : null,
    widthCm: raw.widthCm ?? raw.width_cm != null ? parseFloat(String(raw.widthCm ?? raw.width_cm)) : null,
    heightCm: raw.heightCm ?? raw.height_cm != null ? parseFloat(String(raw.heightCm ?? raw.height_cm)) : null,
    size: raw.size || null,
    basePrice: new Prisma.Decimal(String(raw.basePrice ?? raw.base_price ?? 0)),
    marginPct: new Prisma.Decimal(String(raw.marginPct ?? raw.margin_pct ?? 0)),
    finalPrice: new Prisma.Decimal(String(raw.finalPrice ?? raw.final_price ?? 0)),
    imageUrl: raw.imageUrl || null,
    unit: raw.unit || 'قطعة',
    color: raw.color || null,
    descrption: raw.descrption || raw.description || null,
    createdAt: raw.createdAt ?? raw.created_at ? new Date(raw.createdAt ?? raw.created_at) : undefined,
    updatedAt: raw.updatedAt ?? raw.updated_at ? new Date(raw.updatedAt ?? raw.updated_at) : new Date(),
});

interface BackupJson {
    version: string;
    exported_at: string;
    categories: any[];
    products: any[];
}

const validateBackupJson = (data: any): data is BackupJson => {
    return (
        data && typeof data === 'object' &&
        data.version === '1.0' &&
        Array.isArray(data.categories) &&
        Array.isArray(data.products)
    );
};

/** Save current DB state to a JSON file on disk */
const takeJsonSnapshot = async (safetyDir: string): Promise<string> => {
    const [categories, products] = await Promise.all([
        prisma.category.findMany(),
        prisma.product.findMany(),
    ]);

    const snapshot = {
        version: '1.0',
        exported_at: new Date().toISOString(),
        categories,
        products,
    };

    const isProjectDir = safetyDir.includes('backend') || safetyDir.includes('src') || safetyDir.startsWith('.');
    const finalDir = isProjectDir ? path.join(os.tmpdir(), 'inventory-snapshots') : safetyDir;

    await fs.mkdir(finalDir, { recursive: true });

    const timestamp = Date.now();
    const safetyPath = path.join(finalDir, `safety_snapshot_${timestamp}.json`);
    await fs.writeFile(safetyPath, JSON.stringify(snapshot, null, 2));

    console.log('[Restore] Safety snapshot at:', safetyPath);
    return safetyPath;
};
/** Restore categories and products from JSON data */
const restoreFromJson = async (data: BackupJson) => {
    console.log('[Restore] Starting...');

    await prisma.$transaction(async (tx) => {
        console.log('[Restore] Clearing existing data...');

        // Delete in correct order: products first (child), then categories (parent)
        await tx.stockHistory.deleteMany({});
        await tx.product.deleteMany({});
        await tx.category.deleteMany({});

        console.log(`[Restore] Inserting ${data.categories.length} categories...`);

        const insertedCats = new Set<string>();
        const pendingCats = data.categories.map(normalizeCat);
        let iterations = 0;
        const maxIterations = pendingCats.length * 2;

        while (pendingCats.length > 0 && iterations < maxIterations) {
            iterations++;
            const cat = pendingCats.shift()!;

            if (cat.parentId && !insertedCats.has(cat.parentId)) {
                pendingCats.push(cat);
                continue;
            }

            await tx.category.create({ data: cat });
            insertedCats.add(cat.id);
        }

        if (pendingCats.length > 0) {
            throw new Error(`${pendingCats.length} categories have missing parents`);
        }

        console.log(`[Restore] Inserting ${data.products.length} products...`);

        if (data.products.length > 0) {
            const batchSize = 500;
            const normalizedProducts = data.products.map(normalizeProd);

            for (let i = 0; i < normalizedProducts.length; i += batchSize) {
                const batch = normalizedProducts.slice(i, i + batchSize);
                await tx.product.createMany({ data: batch });
                console.log(`[Restore] Batch ${Math.floor(i / batchSize) + 1} done`);
            }
        }

        console.log('[Restore] Transaction complete');
    }, {
        maxWait: 10000,
        timeout: 120000,
    });
};

/** GET /api/admin/backup — download JSON backup */

export const backup = async (_req: Request, res: Response) => {
    try {
        const [categories, products] = await Promise.all([
            prisma.category.findMany(),
            prisma.product.findMany(),
        ]);

        const backupData = {
            version: '1.0',
            exported_at: new Date().toISOString(),
            categories,
            products,
        };

        const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Keep the download available when the archive directory is not writable.
        try {
            const safetyDir = process.env.SAFETY_SNAPSHOT_DIR || './safety_snapshots';
            const isProjectDir = safetyDir.includes('backend') || safetyDir.includes('src') || safetyDir.startsWith('.');
            const finalDir = isProjectDir ? path.join(os.tmpdir(), 'inventory-snapshots') : safetyDir;

            await fs.mkdir(finalDir, { recursive: true });
            await fs.writeFile(path.join(finalDir, filename), JSON.stringify(backupData, null, 2));
        } catch (snapshotError) {
            console.warn('Backup archive could not be saved; sending download anyway:', snapshotError);
        }

        res.json(backupData);
    } catch (err: any) {
        console.error('Backup error:', err);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Backup failed', error: err.message });
        }
    }
};
/** POST /api/admin/restore — upload JSON and restore */
export const restore = async (req: Request, res: Response) => {
    const safetyDir = process.env.SAFETY_SNAPSHOT_DIR || './safety_snapshots';

    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    console.log('[Restore] File uploaded:', req.file.originalname, 'size:', req.file.size);
    const tempPath = req.file.path;

    try {
        const stats = await fs.stat(tempPath);
        const maxSize = parseInt(process.env.RESTORE_MAX_FILE_SIZE_MB || '50', 10) * 1024 * 1024;
        if (stats.size > maxSize) {
            await fs.unlink(tempPath).catch(() => { });
            return res.status(400).json({ message: 'File too large' });
        }

        let backupData: any;
        try {
            const raw = await fs.readFile(tempPath, 'utf-8');
            backupData = JSON.parse(raw);
        } catch {
            await fs.unlink(tempPath).catch(() => { });
            return res.status(400).json({ message: 'Invalid JSON file' });
        }

        if (!validateBackupJson(backupData)) {
            await fs.unlink(tempPath).catch(() => { });
            return res.status(400).json({ message: 'Invalid backup format' });
        }

        const safetyPath = await takeJsonSnapshot(safetyDir);

        try {
            await restoreFromJson(backupData);
            await fs.unlink(tempPath).catch(() => { });
            return res.json({ message: 'Restore completed successfully', snapshotPath: safetyPath });
        } catch (restoreErr: any) {
            console.error('[Restore] Failed:', restoreErr.message);

            try {
                console.log('[Restore] Rolling back...');
                const safetyRaw = await fs.readFile(safetyPath, 'utf-8');
                const safetyData = JSON.parse(safetyRaw);
                if (validateBackupJson(safetyData)) {
                    await restoreFromJson(safetyData);
                    return res.status(500).json({
                        message: 'Restore failed. Rolled back to safety snapshot.',
                        error: restoreErr.message,
                        snapshotPath: safetyPath,
                    });
                }
            } catch (rollbackErr: any) {
                console.error('[Restore] Rollback also failed:', rollbackErr.message);
                return res.status(500).json({
                    message: 'Restore failed and rollback also failed.',
                    error: restoreErr.message,
                    rollbackError: rollbackErr.message,
                    snapshotPath: safetyPath,
                });
            }
        }
    } catch (err: any) {
        await fs.unlink(tempPath).catch(() => { });
        console.error('[Restore] Fatal error:', err);
        return res.status(500).json({ message: 'Restore failed', error: err.message });
    }
};























// export const backup = (req: Request, res: Response) => {
//     const dbUrl = process.env.DIRECT_URL;
//     const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';

//     if (!dbUrl) {
//         return res.status(500).json({ message: 'DATABASE_URL not configured' });
//     }

//     const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;

//     res.setHeader('Content-Type', 'application/octet-stream');
//     res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

//     const pgDump = spawn(pgDumpPath, [
//         '--format=custom',
//         '--no-acl',
//         '--no-owner',
//         '--table=public.categories',
//         '--table=public.products',
//         // '--table=public.profiles',
//         '--table=public.stock_history',
//         dbUrl,
//     ]);

//     pgDump.stdout.pipe(res);

//     pgDump.stderr.on('data', (data) => {
//         console.error(`pg_dump stderr: ${data}`);
//     });

//     pgDump.on('error', (err) => {
//         console.error('pg_dump error:', err);
//         if (!res.headersSent) {
//             res.status(500).json({ message: 'Backup failed to start' });
//         } else {
//             res.destroy();
//         }
//     });

//     pgDump.on('close', (code) => {
//         if (code !== 0) {
//             console.error(`pg_dump exited with code ${code}`);
//         }
//         if (!res.writableEnded) {
//             res.end();
//         }
//     });
// };


// export const restore = async (req: Request, res: Response) => {
//     const dbUrl = process.env.DIRECT_URL;
//     const pgRestorePath = process.env.PG_RESTORE_PATH || 'pg_restore';
//     const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';
//     const safetyDir = process.env.SAFETY_SNAPSHOT_DIR || './safety_snapshots';

//     if (!dbUrl) {
//         return res.status(500).json({ message: 'DATABASE_URL not configured' });
//     }

//     if (!req.file) {
//         return res.status(400).json({ message: 'No file uploaded' });
//     }

//     const tempPath = req.file.path;

//     try {
//         // 1. Validate magic bytes for .dump files
//         if (req.file.originalname.toLowerCase().endsWith('.dump')) {
//             const fd = await fs.open(tempPath, 'r');
//             const buffer = Buffer.alloc(4);
//             await fd.read(buffer, 0, 4, 0);
//             await fd.close();

//             // PGDM = 0x50 0x47 0x44 0x4D
//             if (buffer.toString('hex') !== '5047444d') {
//                 await fs.unlink(tempPath).catch(() => { });
//                 return res.status(400).json({ message: 'Invalid PostgreSQL custom dump format' });
//             }
//         }

//         // 2. Ensure safety directory exists
//         await fs.mkdir(safetyDir, { recursive: true });

//         // 3. Take safety snapshot
//         const timestamp = Date.now();
//         const safetyPath = path.join(safetyDir, `safety_snapshot_${timestamp}.dump`);

//         await new Promise<void>((resolve, reject) => {
//             const safetyDump = spawn(pgDumpPath, [
//                 '--format=custom',
//                 '--no-acl',
//                 '--no-owner',
//                 '--table=public.categories',
//                 '--table=public.products',
//                 // '--table=public.profiles',
//                 '--table=public.stock_history',
//                 dbUrl,
//             ]);

//             const writeStream = createWriteStream(safetyPath);

//             let errorOutput = '';

//             safetyDump.stdout.pipe(writeStream);

//             safetyDump.stderr.on('data', (data: Buffer) => {
//                 errorOutput += data.toString();

//                 console.error(
//                     `Safety snapshot stderr: ${data.toString()}`
//                 );
//             });

//             safetyDump.on('error', (err) => {
//                 writeStream.destroy();
//                 reject(err);
//             });

//             writeStream.on('error', (err) => {
//                 reject(err);
//             });

//             safetyDump.on('close', (code) => {
//                 if (code === 0) {
//                     writeStream.end(() => {
//                         resolve();
//                     });
//                 } else {
//                     writeStream.destroy();

//                     reject(
//                         new Error(
//                             `Safety snapshot failed with code ${code}: ${errorOutput || 'Unknown pg_dump error'
//                             }`
//                         )
//                     );
//                 }
//             });
//         });

//         // 4. Restore from uploaded file
//         const restoreResult = await runPgRestore(pgRestorePath, dbUrl, tempPath);

//         // Clean up uploaded temp file
//         await fs.unlink(tempPath).catch(() => { });

//         if (restoreResult.success) {
//             return res.json({
//                 message: 'Restore completed successfully',
//                 snapshotPath: safetyPath,
//             });
//         }

//         // 5. Restore failed — attempt rollback
//         console.error('Restore failed, attempting rollback from safety snapshot...');
//         const rollbackResult = await runPgRestore(pgRestorePath, dbUrl, safetyPath);

//         if (rollbackResult.success) {
//             return res.status(500).json({
//                 message: 'Restore failed. Database rolled back to safety snapshot.',
//                 error: restoreResult.error,
//                 snapshotPath: safetyPath,
//             });
//         }

//         return res.status(500).json({
//             message: 'Restore failed and rollback also failed.',
//             error: restoreResult.error,
//             rollbackError: rollbackResult.error,
//             snapshotPath: safetyPath,
//         });
//     } catch (err: any) {
//         await fs.unlink(tempPath).catch(() => { });
//         console.error('Restore error:', err);
//         return res.status(500).json({ message: 'Restore failed', error: err.message });
//     }
// };

// // Helper: run pg_restore and capture result
// function runPgRestore(
//     pgRestorePath: string,
//     dbUrl: string,
//     filePath: string
// ): Promise<{ success: boolean; error?: string }> {
//     return new Promise((resolve) => {
//         const pgRestore = spawn(pgRestorePath, [
//             '--clean',
//             '--if-exists',
//             '--no-owner',
//             '--no-acl',
//             `--dbname=${dbUrl}`,
//             filePath,
//         ]);

//         let errorOutput = '';

//         pgRestore.stderr.on('data', (data: Buffer) => {
//             errorOutput += data.toString();

//             console.error(
//                 `pg_restore stderr: ${data.toString()}`
//             );
//         });

//         pgRestore.on('error', (err) => {
//             resolve({
//                 success: false,
//                 error: err.message,
//             });
//         });

//         pgRestore.on('close', (code) => {
//             console.log(`pg_restore exited with code: ${code}`);

//             if (code === 0) {
//                 resolve({
//                     success: true,
//                 });
//             } else {
//                 resolve({
//                     success: false,
//                     error:
//                         errorOutput ||
//                         `pg_restore exited with code ${code}`,
//                 });
//             }
//         });
//     });
// }