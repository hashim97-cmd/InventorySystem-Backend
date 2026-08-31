import { prisma } from '../lib/prisma.js';

export const attachCategories = async (products: any[]) => {
    // Collect unique categoryIds
    const categoryIds = Array.from(
        new Set(
            products
                .filter((p) => p.categoryId)
                .map((p) => p.categoryId)
        )
    );

    // Fetch all categories at once
    const categories = categoryIds.length > 0
        ? await prisma.category.findMany({
            where: {
                id: {
                    in: categoryIds,
                },
            },
        })
        : [];

    // Create a map of categoryId -> category for quick lookup
    const categoryMap = new Map(
        categories.map((cat) => [cat.id, cat])
    );

    // Attach categories to products
    return products.map((product) => ({
        ...product,
        category: product.categoryId
            ? categoryMap.get(product.categoryId)
            : null,
    }));
};
