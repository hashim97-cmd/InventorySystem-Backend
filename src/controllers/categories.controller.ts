import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.ts';

export type Category = {
    id: string;
    name: string;
    parent_id: string | null;
    sort_order: number;
    created_at: string;
    children?: Category[];
    product_count?: number;
};

export type Product = {
    id: string;
    name: string;
    code: string;
    category_id: string | null;
    quantity: number;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
    size: string | null;
    base_price: number;
    margin_pct: number;
    final_price: number;
    image_url: string | null;
    created_at: string;
    updated_at: string;
    category?: Category;
};

// Define request body types
type CreateCategoryBody = {
    name: string;
    parentId?: string | null;
};

type UpdateCategoryBody = {
    name?: string;
    parentId?: string | null;
};

export const getAllCategories = async (_req: Request, res: Response): Promise<void> => {
    try {
        const categories: Category[] = await prisma.category.findMany();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching categories', error });
    }
};

export const createCategory = async (
    req: Request<{}, {}, CreateCategoryBody>,
    res: Response
): Promise<void> => {
    try {
        const { name, parentId } = req.body;

        if (!name?.trim()) {
            res.status(400).json({ message: 'Name is required' });
            return;
        }

        // Validate parentId exists if provided
        if (parentId) {
            const parentExists = await prisma.category.findUnique({
                where: { id: parentId }
            });
            
            if (!parentExists) {
                res.status(400).json({ message: 'Parent category not found' });
                return;
            }
        }

        const category = await prisma.category.create({
            data: {
                name: name.trim(),
                parentId: parentId || null,
                sortOrder: 0
            },
        });

        res.status(201).json(category);
    } catch (error) {
        console.error('Error creating category:', error);
        
        // Handle specific Prisma errors
        if (error.code === 'P2002') {
            res.status(409).json({ message: 'Category with this name already exists' });
            return;
        }
        
        res.status(500).json({ 
            message: 'Error creating category',
            ...(process.env.NODE_ENV === 'development' && { error: error.message })
        });
    }
};

export const updateCategory = async (
    req: Request<{ id: string }, {}, UpdateCategoryBody>,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        const { name, parentId } = req.body;

        const category: Category = await prisma.category.update({
            where: { id },
            data: {
                name,
                parentId: parentId !== undefined ? parentId : null
            },
        });
        res.json(category);
    } catch (error) {
        res.status(500).json({ message: 'Error updating category', error });
    }
};

export const deleteCategory = async (
    req: Request<{ id: string }>,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params;
        await prisma.category.delete({ where: { id } });
        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting category', error });
    }
};

export const getProductCounts = async (_req: Request, res: Response): Promise<void> => {
    try {
        const products = await prisma.product.findMany();
        const counts: Record<string, number> = {};
        for (const p of products) {
            if (p.categoryId) {
                counts[p.categoryId] = (counts[p.categoryId] || 0) + 1;
            }
        }
        res.json(counts);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product counts', error });
    }
};
