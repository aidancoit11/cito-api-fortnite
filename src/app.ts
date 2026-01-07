import express, { Express } from 'express';
import { config } from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { rateLimiter } from './middleware/rate-limit.js';

/**
 * Create and configure Express application
 */
export function createApp(): Express {
  const app = express();

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // CORS (allow all origins for now)
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });

  // Rate limiting
  app.use(rateLimiter);

  // Request logging (simple console log for now)
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Fortnite Competitive API',
      version: config.apiVersion,
      status: 'running',
      endpoints: {
        health: `/api/${config.apiVersion}/health`,
        auth: `/api/${config.apiVersion}/auth`,
        docs: 'https://github.com/yourusername/fortnite-competitive-api',
      },
    });
  });

  // API routes
  app.use(`/api/${config.apiVersion}`, routes);

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler
  app.use(errorHandler);

  return app;
}
