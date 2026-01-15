/**
 * Firebase Authentication Middleware
 * Verifies Firebase ID tokens for dashboard authentication
 *
 * Usage:
 * - Add firebaseAuth middleware to routes that require user authentication
 * - Access user info via req.firebaseUser and req.apiUser
 */

import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken, isFirebaseConfigured } from '../services/firebase-admin.service.js';
import { prisma } from '../db/client.js';
import { ApiUser } from '@prisma/client';

// Extend Express Request to include Firebase user info
declare global {
  namespace Express {
    interface Request {
      firebaseUser?: {
        uid: string;
        email: string;
        emailVerified: boolean;
      };
      apiUser?: ApiUser;
    }
  }
}

/**
 * Main Firebase authentication middleware
 * Verifies the Bearer token from Authorization header
 */
export async function firebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Check if Firebase is configured
  if (!isFirebaseConfigured()) {
    res.status(503).json({
      success: false,
      error: 'Authentication service not configured',
    });
    return;
  }

  // Get token from Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'Missing or invalid authorization header. Expected: Bearer <token>',
    });
    return;
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  // Verify the token
  const decoded = await verifyFirebaseToken(token);

  if (!decoded || !decoded.email) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
    return;
  }

  // Attach Firebase user info to request
  req.firebaseUser = {
    uid: decoded.uid,
    email: decoded.email,
    emailVerified: decoded.email_verified || false,
  };

  // Look up corresponding ApiUser
  try {
    const apiUser = await prisma.apiUser.findUnique({
      where: { email: decoded.email },
    });

    if (apiUser) {
      req.apiUser = apiUser;
    }
  } catch (error) {
    console.error('[FirebaseAuth] Failed to lookup ApiUser:', error);
    // Continue even if lookup fails - user might not exist yet
  }

  next();
}

/**
 * Require that the user exists in the database
 * Use after firebaseAuth middleware
 */
export function requireApiUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.apiUser) {
    res.status(404).json({
      success: false,
      error: 'User not found. Please sync your account first.',
    });
    return;
  }

  next();
}

/**
 * Optional Firebase auth - allows requests without token
 * If token is provided and valid, attaches user info
 */
export async function optionalFirebaseAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    // No token provided - continue without auth
    next();
    return;
  }

  const token = authHeader.slice(7);
  const decoded = await verifyFirebaseToken(token);

  if (decoded && decoded.email) {
    req.firebaseUser = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified || false,
    };

    // Look up ApiUser
    try {
      const apiUser = await prisma.apiUser.findUnique({
        where: { email: decoded.email },
      });

      if (apiUser) {
        req.apiUser = apiUser;
      }
    } catch (error) {
      // Ignore lookup errors for optional auth
    }
  }

  next();
}

export const firebaseAuthMiddleware = {
  firebaseAuth,
  requireApiUser,
  optionalFirebaseAuth,
};
