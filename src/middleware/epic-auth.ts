import { Request, Response, NextFunction } from 'express';
import { tokenManager } from '../services/epic/token-manager.js';

/**
 * Epic Auth Middleware
 * Injects valid Epic Games access token into requests
 *
 * Usage in routes:
 *   router.get('/stats/:username', epicAuthMiddleware, async (req, res) => {
 *     const token = req.epicToken; // Valid access token ready to use
 *     const accountId = req.epicAccountId;
 *   });
 */

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      epicToken?: string;
      epicAccountId?: string;
    }
  }
}

/**
 * Middleware that attaches Epic Games authentication to the request
 * Ensures a valid token is available before proceeding
 */
export async function epicAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Check if token manager is ready
    if (!tokenManager.isReady()) {
      try {
        await tokenManager.initialize();
      } catch (error) {
        res.status(503).json({
          error: 'Epic Games authentication not available',
          message: 'Device auth credentials not configured. Run "npm run generate-auth" first.',
        });
        return;
      }
    }

    // Get a valid token (auto-refreshes if needed)
    const token = await tokenManager.getToken();
    const accountId = tokenManager.getAccountId();

    if (!token) {
      res.status(503).json({
        error: 'Epic Games authentication failed',
        message: 'Unable to obtain access token',
      });
      return;
    }

    // Attach to request for downstream handlers
    req.epicToken = token;
    req.epicAccountId = accountId || undefined;

    next();
  } catch (error) {
    console.error('Epic auth middleware error:', error);
    res.status(503).json({
      error: 'Epic Games authentication error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Optional middleware - doesn't fail if auth unavailable
 * Useful for endpoints that can work without Epic auth
 */
export async function optionalEpicAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (tokenManager.isReady()) {
      const token = await tokenManager.getToken();
      req.epicToken = token;
      req.epicAccountId = tokenManager.getAccountId() || undefined;
    }
  } catch {
    // Auth not available, continue without it
  }

  next();
}

/**
 * Route handler wrapper for Epic API calls
 * Automatically handles token refresh on 401 errors
 */
export function withEpicAuth(
  handler: (req: Request, res: Response, token: string, accountId: string) => Promise<void>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Get fresh token
      const token = await tokenManager.getToken();
      const accountId = tokenManager.getAccountId();

      if (!token || !accountId) {
        res.status(503).json({
          error: 'Epic Games authentication not available',
        });
        return;
      }

      try {
        await handler(req, res, token, accountId);
      } catch (error: any) {
        // If 401, refresh and retry once
        if (error.response?.status === 401) {
          console.log('🔄 Got 401, refreshing token and retrying...');
          const newToken = await tokenManager.refresh();
          await handler(req, res, newToken, accountId);
        } else {
          throw error;
        }
      }
    } catch (error) {
      next(error);
    }
  };
}
