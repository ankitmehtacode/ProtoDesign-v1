
// Import types are removed as this is plain JavaScript
// import { Request, Response, NextFunction } from 'express';
// (Express types are handled by external tools like JSDoc or removed entirely)

/**
 * Custom error handler middleware for Express.
 * @param {Error & { status?: number, code?: string }} error - The error object.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next function.
 */
const errorHandler = (error, req, res, next) => {
    // Log error details (in production, use proper logging service)
    console.error('❌ Error:', {
        message: error.message,
        status: error.status || 500,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });

    // Determine status code
    // The 'error' object from your TS interface is a standard Error object,
    // and custom properties like 'status' are accessed directly.
    const status = error.status || 500;
    // 5xx messages are usually driver/library text (SQL, hostnames). They are
    // logged above; the client gets a generic one outside development.
    const message = status >= 500 && process.env.NODE_ENV !== 'development'
        ? 'Internal Server Error'
        : (error.message || 'Internal Server Error');

    // Conditional inclusion of stack trace for development environment
    const errorResponse = {
        status,
        message,
    };

    if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = error.stack;
    }

    // Send error response
    res.status(status).json({
        error: errorResponse,
        timestamp: new Date().toISOString()
    });
};

export default errorHandler;