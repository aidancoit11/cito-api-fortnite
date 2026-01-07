import { Request, Response } from 'express';
import { epicAuthService } from '../services/epic/auth.service.js';
import { config } from '../config/index.js';

/**
 * Auth Controller
 * Handles authentication endpoints for Epic Games OAuth
 */

/**
 * POST /auth/device
 * Generate device auth credentials
 *
 * This endpoint should be called ONCE to generate device auth credentials.
 * Store the returned deviceId, accountId, and secret in your .env file.
 *
 * Request body:
 * {
 *   "email": "your-epic-account@example.com",
 *   "password": "your-password"
 * }
 *
 * Response:
 * {
 *   "deviceId": "...",
 *   "accountId": "...",
 *   "secret": "...",
 *   "message": "Device auth generated successfully. Add these to your .env file."
 * }
 */
export async function generateDeviceAuth(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'Email and password are required',
      });
      return;
    }

    // Step 1: Get access token with email/password
    console.log('Authenticating with Epic Games...');
    const tokenResponse = await epicAuthService.getAccessTokenWithPassword(email, password);

    // Step 2: Generate device auth
    console.log('Generating device auth credentials...');
    const deviceAuth = await epicAuthService.generateDeviceAuth(
      tokenResponse.access_token,
      tokenResponse.account_id
    );

    // Return device auth credentials
    res.status(200).json({
      deviceId: deviceAuth.deviceId,
      accountId: deviceAuth.accountId,
      secret: deviceAuth.secret,
      message:
        'Device auth generated successfully! Add these to your .env file:\n\n' +
        `EPIC_DEVICE_ID=${deviceAuth.deviceId}\n` +
        `EPIC_ACCOUNT_ID=${deviceAuth.accountId}\n` +
        `EPIC_DEVICE_SECRET=${deviceAuth.secret}`,
    });
  } catch (error: any) {
    console.error('Error generating device auth:', error);

    const statusCode = error.response?.status || 500;
    const message = error.response?.data?.errorMessage || 'Failed to generate device auth';

    res.status(statusCode).json({
      error: 'Device auth generation failed',
      message,
      details: error.response?.data,
    });
  }
}

/**
 * POST /auth/token
 * Get access token using device auth or refresh token
 *
 * Request body (device auth):
 * {
 *   "grantType": "device_auth",
 *   "deviceId": "...",
 *   "accountId": "...",
 *   "secret": "..."
 * }
 *
 * Request body (refresh token):
 * {
 *   "grantType": "refresh_token",
 *   "refreshToken": "..."
 * }
 *
 * Response:
 * {
 *   "accessToken": "...",
 *   "refreshToken": "...",
 *   "expiresIn": 28800,
 *   "expiresAt": "2024-01-01T12:00:00.000Z",
 *   "accountId": "...",
 *   "displayName": "..."
 * }
 */
export async function getAccessToken(req: Request, res: Response): Promise<void> {
  try {
    const { grantType } = req.body;

    let tokenResponse;

    if (grantType === 'device_auth') {
      // Use device auth from request body or config
      const deviceId = req.body.deviceId || config.epic.deviceId;
      const accountId = req.body.accountId || config.epic.accountId;
      const secret = req.body.secret || config.epic.deviceSecret;

      if (!deviceId || !accountId || !secret) {
        res.status(400).json({
          error: 'Missing device auth credentials',
          message:
            'deviceId, accountId, and secret are required (or set in .env file)',
        });
        return;
      }

      tokenResponse = await epicAuthService.getAccessTokenWithDeviceAuth(
        deviceId,
        accountId,
        secret
      );
    } else if (grantType === 'refresh_token') {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          error: 'Missing refresh token',
          message: 'refreshToken is required',
        });
        return;
      }

      tokenResponse = await epicAuthService.refreshAccessToken(refreshToken);
    } else {
      res.status(400).json({
        error: 'Invalid grant type',
        message: 'grantType must be "device_auth" or "refresh_token"',
      });
      return;
    }

    // Return token info
    res.status(200).json({
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresIn: tokenResponse.expires_in,
      expiresAt: tokenResponse.expires_at,
      accountId: tokenResponse.account_id,
      displayName: tokenResponse.displayName,
      tokenType: tokenResponse.token_type,
    });
  } catch (error: any) {
    console.error('Error getting access token:', error);

    const statusCode = error.response?.status || 500;
    const message = error.response?.data?.errorMessage || 'Failed to get access token';

    res.status(statusCode).json({
      error: 'Token retrieval failed',
      message,
      details: error.response?.data,
    });
  }
}

/**
 * GET /auth/verify
 * Verify if an access token is still valid
 *
 * Headers:
 * Authorization: Bearer <access_token>
 *
 * Response:
 * {
 *   "valid": true
 * }
 */
export async function verifyToken(req: Request, res: Response): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Missing authorization header',
        message: 'Authorization header with Bearer token is required',
      });
      return;
    }

    const accessToken = authHeader.split(' ')[1];

    const isValid = await epicAuthService.verifyToken(accessToken);

    res.status(200).json({
      valid: isValid,
    });
  } catch (error: any) {
    console.error('Error verifying token:', error);

    res.status(500).json({
      error: 'Token verification failed',
      message: error.message,
    });
  }
}
