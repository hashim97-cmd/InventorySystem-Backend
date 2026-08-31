import "./config/env.js";

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { ApiError } from "./utils/apiError.js";
import cookieParser from "cookie-parser";
// routes
import authRoute from "./routes/auth.routes.js";
import categoriesRoutes from './routes/categories.routes.js';
import adminRoutes from './routes/admin.routes.js';
import productsRoutes from './routes/products.routes.js';
import uploadRoutes from "./routes/upload.routes.js";

const app = express();
const configuredOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const allowedOrigins = [
    'http://localhost:3000',  // development
    ...configuredOrigins,
];

app.use(cors({
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // allow requests with no origin like mobile apps or curl
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,  // <-- allow cookies
}));
const PORT = process.env.PORT || 3000;


// Capture raw body for signature verification
app.use(
    bodyParser.json({
        verify: (req: Request, res: Response, buf: Buffer) => {
            req.rawBody = buf.toString();
        },
    })
);

app.use(cookieParser());

app.use(express.json());

// user routes
app.use("/api/auth", authRoute);
app.use('/api/categories', categoriesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api', adminRoutes);
app.use('/api/upload', uploadRoutes);


app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("🔥 ERROR:", err);

    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            status: err.status,
            message: err.message,
        });
    }

    // Unexpected error (not ApiError)
    return res.status(500).json({
        status: "error",
        message: "Something went wrong on the server",
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

