import { Request, Response } from 'express';
import { supabaseAnon, supabaseAdmin } from '../lib/supabase.ts';
import { prisma } from '../lib/prisma.ts';



// GET /api/auth/me — already exists, keep it
export const getMe = (req: Request, res: Response) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    return res.json({
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
    });
};

// POST /api/auth/signup
export const signup = async (req: Request, res: Response) => {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password required' });
    }

    // Use admin client to create user to avoid email confirmation requirements for this example,
    // or anon client if you want standard flow. Using Admin here to instantly create the profile.
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
    });


    if (error || !data.user) {
        return res.status(400).json({ message: error?.message || 'Error creating user' });
    }

    try {
        // Create the profile in Prisma
        await prisma.profile.create({
            data: {
                user_id: data.user.id,
                email: email,
                role: 'user',
            },
        });

        return res.status(201).json({
            message: 'User created successfully',
            user: { id: data.user.id, email: data.user.email },
        });
    } catch (dbError) {
        console.error('Error creating profile:', dbError);
        // If profile creation fails, we might want to clean up the Supabase user, 
        // but for now just return error
        return res.status(500).json({ message: 'Error creating user profile' });
    }
};

// POST /api/auth/login
export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;


    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password required' });
    }

    const { data, error } = await supabaseAnon.auth.signInWithPassword({
        email,
        password,
    });

    if (error || !data.session) {
        return res.status(401).json({ message: error?.message || 'Invalid credentials' });
    }

    const isProd = process.env.NODE_ENV === 'production';

    res.cookie('access_token', data.session.access_token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: data.session.expires_in * 1000,
    });

    res.cookie('refresh_token', data.session.refresh_token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return res.json({
        user: data.user,
    });
};


// POST /api/auth/logout
export const logout = async (req: Request, res: Response) => {
    // Try to get token from cookies or authorization header
    const token = req.cookies.access_token || req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Missing token' });
    }

    // Call Supabase GoTrue logout directly to revoke this session server-side
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
            apikey: process.env.SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${token}`,
        },
    });

    // Clear cookies regardless of supabase logout success to ensure client is logged out locally
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');

    if (!response.ok) {
        return res.status(400).json({ message: 'Logout failed on server, but local session cleared' });
    }

    return res.json({ message: 'Logged out successfully' });
};

// POST /api/auth/refresh
export const refresh = async (req: Request, res: Response) => {
    // Read refresh token from cookies
    const refresh_token = req.cookies.refresh_token || req.body.refresh_token;

    if (!refresh_token) {
        return res.status(400).json({ message: 'Refresh token required' });
    }

    const { data, error } = await supabaseAnon.auth.refreshSession({
        refresh_token,
    });

    if (error || !data.session) {
        return res.status(401).json({ message: error?.message || 'Invalid refresh token' });
    }

    const isProd = process.env.NODE_ENV === 'production';

    res.cookie('access_token', data.session.access_token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: data.session.expires_in * 1000,
    });

    res.cookie('refresh_token', data.session.refresh_token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return res.json({
        user: data.user,
    });
};
