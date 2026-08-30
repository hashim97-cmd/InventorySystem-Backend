import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.ts';
import { Prisma } from '../generated/prisma/client.ts';
import { attachCategories } from '../utils/productUtils.ts';
import { ApiError } from '@/utils/apiError.ts';

const LOW_STOCK_THRESHOLD = 10;

const getStockAvailability = (quantity: number) => {
    if (quantity === 0) {
        return 'OUT_OF_STOCK';
    }

    if (quantity <= LOW_STOCK_THRESHOLD) {
        return 'LOW_STOCK';
    }

    return 'IN_STOCK';
};

export const getProducts = async (req: Request, res: Response): Promise<void> => {
    const {
        search,
        categoryId,
        page = '1',
        limit = '12',
        sort_by = 'createdAt',
        sort_dir = 'desc',
    } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.ProductWhereInput = {
        AND: [
            search
                ? {
                    OR: [
                        { name: { contains: search as string, mode: 'insensitive' } },
                        { code: { contains: search as string, mode: 'insensitive' } },
                    ],
                }
                : {},
            categoryId ? { categoryId: categoryId as string } : {},
        ],
    };

    const [products, total] = await Promise.all([
        prisma.product.findMany({
            where,
            skip,
            take: limitNum,
            orderBy: { [sort_by as string]: sort_dir },
        }),
        prisma.product.count({ where }),
    ]);
    // Fetch categories separately if products have categoryId
    const productsWithStockStatus = products.map((product) => ({
        ...product,
        stockAvailability: getStockAvailability(
            product.quantity
        ),
    }));

    const data = await attachCategories(
        productsWithStockStatus
    );

    res.json({
        data,
        total,
    });
}

export const getLowStockProducts = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const {
            search,
            categoryId,
            page = '1',
            limit = '12',
        } = req.query;

        const pageNum = Math.max(
            parseInt(page as string, 10) || 1,
            1
        );

        const limitNum = Math.max(
            parseInt(limit as string, 10) || 12,
            1
        );

        const skip = (pageNum - 1) * limitNum;

        const where: Prisma.ProductWhereInput = {
            quantity: {
                gt: 0,
                lte: LOW_STOCK_THRESHOLD,
            },

            AND: [
                search
                    ? {
                        OR: [
                            {
                                name: {
                                    contains: search as string,
                                    mode: 'insensitive',
                                },
                            },
                            {
                                code: {
                                    contains: search as string,
                                    mode: 'insensitive',
                                },
                            },
                        ],
                    }
                    : {},

                categoryId
                    ? {
                        categoryId: categoryId as string,
                    }
                    : {},
            ],
        };

        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                skip,
                take: limitNum,

                // Show products with the lowest stock first
                orderBy: {
                    quantity: 'asc',
                },
            }),

            prisma.product.count({
                where,
            }),
        ]);

        const productsWithStockStatus = products.map((product) => ({
            ...product,
            stockAvailability: getStockAvailability(
                product.quantity
            ),
        }));

        const data = await attachCategories(productsWithStockStatus);


        res.json({
            status: 'success',
            data,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
            threshold: LOW_STOCK_THRESHOLD,
        });
    } catch (error) {
        console.error(
            'Error fetching low stock products:',
            error
        );

        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch low stock products',
        });
    }
};

export const getOutOfStockProducts = async (
    _req: Request,
    res: Response
): Promise<void> => {
    try {
        const products = await prisma.product.findMany({
            where: { quantity: 0 },
            orderBy: { name: 'asc' },
        });

        const productsWithStockStatus = products.map((product) => ({
            ...product,
            stockAvailability: getStockAvailability(product.quantity),
        }));

        const data = await attachCategories(productsWithStockStatus);
        res.json({ status: 'success', data, total: data.length });
    } catch (error) {
        console.error('Error fetching out of stock products:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch out of stock products',
        });
    }
};

export const getProductsByCategory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { categoryId } = req.params;

        const products = await prisma.product.findMany({
            where: { categoryId: categoryId },
        });

        const data = await attachCategories(products);

        res.json(data);
    } catch (error) {
        console.error('Error fetching products by category:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
};

export const getProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const product = await prisma.product.findUnique({
            where: { id },
            include: {
                stockHistory: {
                    orderBy: {
                        createdAt: 'desc',
                    },
                },
            },
        });

        if (!product) {
            res.status(404).json({ message: 'Product not found' });
            return;
        }

        // Manually fetch category if product has categoryId
        const withCategory = await attachCategories([product]);

        res.json({
            ...product,
            stockAvailability: getStockAvailability(
                product.quantity
            ),
            category: withCategory[0]?.category,
        });

    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
}

export const createProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            name,
            code,
            categoryId,
            quantity,
            lengthCm,
            widthCm,
            heightCm,
            size,
            basePrice,
            marginPct,
            finalPrice, // Optional - can be sent manually
            imageUrl,
            unit,
            color,
            descrption
        } = req.body;

        // Validate required fields
        if (!name || !code || basePrice === undefined) {
            res.status(400).json({
                error: 'Validation error',
                message: 'name, code, and basePrice are required',
            });
            return;
        }

        // Build the data object
        const productData: any = {
            name,
            code,
            categoryId: categoryId || null,
            quantity: quantity !== undefined ? parseInt(quantity) : 0,
            lengthCm: lengthCm ? new Prisma.Decimal(lengthCm) : null,
            widthCm: widthCm ? new Prisma.Decimal(widthCm) : null,
            heightCm: heightCm ? new Prisma.Decimal(heightCm) : null,
            size: size || null,
            basePrice: new Prisma.Decimal(basePrice),
            marginPct: new Prisma.Decimal(marginPct || 0),
            imageUrl: imageUrl || null,
            unit: unit || 'قطعة',
            color: color || null,
            descrption: descrption || null,
        };

        // Only add finalPrice if explicitly provided
        // If not provided, the database will calculate it using: base_price * (1 + margin_pct / 100)
        if (finalPrice !== undefined && finalPrice !== null && finalPrice !== '') {
            productData.finalPrice = new Prisma.Decimal(finalPrice);
        } else {
            // Auto-calculate finalPrice
            const base = parseFloat(basePrice);
            const margin = parseFloat(marginPct || '0');
            const calculatedFinalPrice = (base * (1 + margin / 100)).toFixed(2);
            productData.finalPrice = new Prisma.Decimal(calculatedFinalPrice);
        }

        // Create the product
        const product = await prisma.product.create({
            data: {
                ...productData,
                stockHistory: productData.quantity !== 0 ? {
                    create: {
                        change: productData.quantity,
                        operation: 'CREATE',
                        notes: 'Initial stock'
                    }
                } : undefined
            },
        });

        // Manually fetch the category if categoryId exists
        const category = await attachCategories([product]);

        // Return product with category
        res.json({
            ...product,
            category: category[0]?.category
        });

    } catch (err: any) {
        if (err.code === 'P2002') {
            res.status(409).json({
                field: 'code',
                message: 'هذا الكود مستخدم بالفعل',
            });
            return;
        }
        console.error('Error creating product:', err);
        res.status(500).json({
            error: 'Failed to create product',
            details: err.message
        });
    }
};

const UPDATABLE_FIELDS: Record<string, (v: any) => any> = {
    name: (v) => v,
    code: (v) => v,
    categoryId: (v) => v || null,
    quantity: (v) => parseInt(v),
    lengthCm: (v) => (v ? new Prisma.Decimal(v) : null),
    widthCm: (v) => (v ? new Prisma.Decimal(v) : null),
    heightCm: (v) => (v ? new Prisma.Decimal(v) : null),
    size: (v) => v || null,
    basePrice: (v) => new Prisma.Decimal(v),
    marginPct: (v) => new Prisma.Decimal(v),
    imageUrl: (v) => v || null,
    unit: (v) => v,
    color: (v) => v || null,
    descrption: (v) => v || null,
};

const PRISMA_ERROR_MAP: Record<string, { status: number; body: Record<string, any> }> = {
    P2002: { status: 409, body: { status: 'fail', field: 'code', message: 'هذا الكود مستخدم بالفعل' } },
    P2025: { status: 404, body: { status: 'fail', message: 'Product not found' } },
    P2023: { status: 400, body: { status: 'fail', message: 'Invalid product ID format' } },
};

export const updateProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params;

    try {
        const existingProduct = await prisma.product.findUnique({ where: { id } });
        if (!existingProduct) throw new ApiError(404, 'Product not found');

        const body = req.body;
        const updateData: any = {};

        for (const [field, transform] of Object.entries(UPDATABLE_FIELDS)) {
            if (body[field] !== undefined) {
                updateData[field] = transform(body[field]);
            }
        }

        // finalPrice: manual value wins, otherwise recalc if base/margin changed
        const { finalPrice, basePrice, marginPct } = body;
        if (finalPrice !== undefined && finalPrice !== null && finalPrice !== '') {
            updateData.finalPrice = new Prisma.Decimal(finalPrice);
        } else if (basePrice !== undefined || marginPct !== undefined) {
            const base = basePrice !== undefined ? parseFloat(basePrice) : parseFloat(existingProduct.basePrice.toString());
            const margin = marginPct !== undefined ? parseFloat(marginPct) : parseFloat(existingProduct.marginPct.toString());
            updateData.finalPrice = new Prisma.Decimal((base * (1 + margin / 100)).toFixed(2));
        }

        if (updateData.quantity !== undefined && updateData.quantity !== existingProduct.quantity) {
            const diff = updateData.quantity - existingProduct.quantity;
            updateData.stockHistory = {
                create: {
                    change: diff,
                    operation: 'UPDATE',
                    notes: 'Manual update'
                }
            };
        }

        const product = await prisma.product.update({ where: { id }, data: updateData });

        const category = product.categoryId
            ? await prisma.category.findUnique({ where: { id: product.categoryId } })
            : null;

        res.json({ status: 'success', data: { ...product, category } });
    } catch (err: any) {
        if (err.code && PRISMA_ERROR_MAP[err.code]) {
            const { status, body } = PRISMA_ERROR_MAP[err.code];
            res.status(status).json(body);
            return;
        }

        if (err instanceof ApiError) {
            res.status(err.statusCode).json({ status: err.status, message: err.message });
            return;
        }

        console.error('Error updating product:', err);
        res.status(500).json({ status: 'error', message: 'Failed to update product' });
    }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        // Check if product exists
        const product = await prisma.product.findUnique({
            where: { id },
        });

        if (!product) {
            throw new ApiError(404, 'Product not found');
        }

        // Delete the product
        await prisma.product.delete({
            where: { id }
        });

        res.json({
            status: 'success',
            message: 'Product deleted successfully',
            data: product // Optional: return deleted product
        });

    } catch (err: any) {
        // Handle Prisma-specific errors
        if (err.code === 'P2025') {
            throw new ApiError(404, 'Product not found');
        }

        if (err.code === 'P2003') {
            throw new ApiError(409, 'Cannot delete product. It has related records.');
        }

        if (err.code === 'P2023') {
            throw new ApiError(400, 'Invalid product ID format');
        }

        // If it's already an ApiError, pass it through
        if (err instanceof ApiError) {
            res.status(err.statusCode).json({
                status: err.status,
                message: err.message
            });
            return;
        }

        // Generic error
        console.error('Error deleting product:', err.message);
        res.status(500).json({
            status: 'error',
            message: `Failed to delete product :${err.message}`
        });
    }
};