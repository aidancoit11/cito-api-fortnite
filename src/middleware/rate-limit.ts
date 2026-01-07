import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

/**
 * Rate limiting middleware
 * Protects the API from abuse
 */

export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 minutes default
  max: config.rateLimit.maxRequests, // 100 requests per window default
  message: {
    error: {
      message: 'Too many requests from this IP, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Store in memory (upgrade to Redis for production)
});

/**
 * Stricter rate limiting for authentication endpoints
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Only 10 auth requests per 15 minutes
  message: {
    error: {
      message: 'Too many authentication attempts, please try again later.',
      statusCode: 429,
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
