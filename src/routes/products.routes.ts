import { Router } from 'express';

import { getProducts, getProductsByCategory, getProduct, getLowStockProducts, getOutOfStockProducts, createProduct, updateProduct, deleteProduct } from '@/controllers/products.controller.ts';


import { authenticate } from '../middleware/authenticate.ts';
import { requireAdmin } from '../middleware/requireAdmin.ts';

const router = Router();

router.get('/', authenticate, getProducts);
router.get('/by-category/:categoryId', authenticate, getProductsByCategory);
router.get('/low-stock', authenticate, getLowStockProducts);
router.get('/out-of-stock', authenticate, getOutOfStockProducts);
router.get('/:id', authenticate, getProduct);
router.post('/', authenticate, createProduct);
router.patch('/:id', authenticate, updateProduct);
router.delete('/:id', authenticate, requireAdmin, deleteProduct);

export default router;  