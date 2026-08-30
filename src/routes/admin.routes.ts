import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { createUser, getAllUsers, updateUser, deleteUser, backup, restore } from '../controllers/admin.controller.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { requireAdmin, requireSuperAdmin } from '../middleware/requireAdmin.ts';
import { backupLimiter, restoreLimiter } from '../middleware/rateLimiter.ts';

const router = Router();

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, file, cb) => {
            const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            cb(null, `restore-${unique}${path.extname(file.originalname)}`);
        },
    }),
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.dump', '.sql'].includes(ext)) cb(null, true);
        else cb(new Error('Only .dump and .sql files are allowed'));
    },
});

// User management
router.post('/users', authenticate, requireSuperAdmin, createUser);
router.get('/users', authenticate, requireSuperAdmin, getAllUsers);
router.patch('/users/:id', authenticate, requireSuperAdmin, updateUser);
router.delete('/users/:id', authenticate, requireSuperAdmin, deleteUser);

// Backup / Restore
router.get('/backup', authenticate, requireAdmin, backupLimiter, backup);
router.post('/restore', authenticate, requireAdmin, restoreLimiter, upload.single('file'), restore);

export default router;