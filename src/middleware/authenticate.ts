import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { prisma } from '../lib/prisma.js';

const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL is not configured in environment variables');
}

// JWKS client fetches and caches the public key from Supabase
const client = jwksClient({
  jwksUri: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,  // <-- added /auth/v1
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key!.getPublicKey();
    callback(null, signingKey);
  });
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = req.cookies?.access_token || (bearerMatch ? bearerMatch[1] : null);

  if (!token) {
    return res.status(401).json({ message: 'Missing token' });
  }

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['ES256'], // <-- Changed from HS256 to ES256
    },
    async (err: jwt.VerifyErrors | null, decoded: jwt.JwtPayload | string | undefined) => {
      if (err) {
        console.error('JWT verification failed:', err.message);
        return res.status(401).json({ message: 'Invalid token' });
      }

      const payload = decoded as jwt.JwtPayload;

      try {
        const profile = await prisma.profile.findUnique({
          where: { user_id: payload.sub },
        });

        // 🔒 DELETED USER = LOCKOUT
        // If profile is gone, the user was deleted by admin — reject immediately
        if (!profile) {
          return res.status(401).json({ message: 'User not found or deactivated' });
        }

        req.user = {
          id: payload.sub as string,
          email: (payload.email as string) || '',
          role: profile?.role || 'user',
        };

        next();
      } catch (dbErr) {
        console.error('Database error during auth:', dbErr);
        return res.status(500).json({ message: 'Authentication failed' });
      }
    }
  );
};