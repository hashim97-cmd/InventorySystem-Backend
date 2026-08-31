import { Router } from 'express';
import {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getProductCounts,
} from '../controllers/categories.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

router.get('/', authenticate, getAllCategories);
router.get('/product-counts', authenticate, getProductCounts);
router.post('/', authenticate, requireAdmin, createCategory);
router.patch('/:id', authenticate, requireAdmin, updateCategory);
router.delete('/:id', authenticate, requireAdmin, deleteCategory);

export default router;