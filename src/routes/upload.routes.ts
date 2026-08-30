import { Router } from 'express';
import multer from 'multer';
import { uploadImage, deleteImage } from '../controllers/upload.controller.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { requireAdmin } from '../middleware/requireAdmin.ts';

const router = Router();

// Memory storage — file stays in RAM, streamed directly to Cloudinary (no disk write)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

router.post('/image', authenticate, requireAdmin, upload.single('file'), uploadImage);
router.delete('/image/:publicId', authenticate, requireAdmin, deleteImage);

export default router;