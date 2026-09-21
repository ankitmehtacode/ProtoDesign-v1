// backend/app.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import serverless from 'serverless-http';

// Import routes
import authRoutes from './src/routes/auth.routes.js';
import productsRoutes from './src/routes/products.routes.js';
import ordersRoutes from './src/routes/orders.routes.js';
import cartRoutes from './src/routes/cart.routes.js';
import quotesRoutes from './src/routes/quotes.routes.js';
import errorHandler from './src/middleware/errorHandler.js';
import userRoutes from './src/routes/user.routes.js';
import sitemapRoutes from './src/routes/sitemap.routes.js';

const app = express();

// Lambda sets this automatically; it is never present locally or in a container.
const IS_LAMBDA = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

// ============================================
// 1. SECURITY MIDDLEWARE
// ============================================

// Allow Google Login Popups and Cross-Origin Images
app.use(helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Origins come from the environment so that a deploy target change is a config
// change, not a code change. FRONTEND_URLS is a comma-separated list.
const configuredOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:3000',
    ...configuredOrigins
];

// Optional, off by default: Vercel preview deployments get a unique URL per
// branch/PR (e.g. protodesign-git-feature-x-team.vercel.app), so an exact list
// cannot cover them. Rather than wildcard-allowing all of *.vercel.app --
// which is shared hosting, so that would trust every app anyone else deploys
// there too -- this accepts one project-scoped regex opted into explicitly.
const previewOriginPattern = process.env.FRONTEND_ORIGIN_PATTERN
    ? new RegExp(process.env.FRONTEND_ORIGIN_PATTERN)
    : null;

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin) ||
            (previewOriginPattern && previewOriginPattern.test(origin)) ||
            process.env.NODE_ENV === 'development' && (
                origin.startsWith('http://192.168.') ||
                origin.startsWith('http://10.') ||
                origin.startsWith('http://localhost')
            )
        ) {
            return callback(null, true);
        }

        console.warn(JSON.stringify({ event: 'cors_blocked', origin }));
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ============================================
// 2. BODY PARSING
// ============================================
// NOTE: Lambda caps the synchronous invoke payload at 6MB. Large files must go
// browser -> S3/Cloudinary directly via presigned upload, never through here.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ============================================
// 3. REQUEST LOGGING
// ============================================
app.use((req, res, next) => {
    console.log(JSON.stringify({ event: 'request', method: req.method, path: req.path }));
    next();
});

// ============================================
// 4. API ROUTES
// ============================================
app.use('/', sitemapRoutes);

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        runtime: IS_LAMBDA ? 'lambda' : 'server'
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/user', userRoutes);

// ============================================
// 5. ERROR HANDLING
// ============================================
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found', path: req.path });
});

app.use(errorHandler);

// ============================================
// 6. ENTRYPOINTS
// ============================================

// Lambda entrypoint. serverless-http translates the Function URL event into the
// req/res pair Express expects, so routing above is unchanged.
export const handler = serverless(app);

// Local / container entrypoint. Skipped under Lambda, where listening on a port
// would do nothing.
if (!IS_LAMBDA) {
    const PORT = Number(process.env.PORT || process.env.API_PORT || 3001);
    const HOST = '0.0.0.0';

    const server = app.listen(PORT, HOST, () => {
        console.log(`✅ Server running on http://${HOST}:${PORT}`);
    });

    process.on('SIGTERM', () => {
        console.log('SIGTERM received. Closing server...');
        server.close(() => process.exit(0));
    });
}

export default app;
