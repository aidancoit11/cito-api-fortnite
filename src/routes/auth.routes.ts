import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

/**
 * GET /auth/status
 * Get the current Epic Games authentication status
 */
router.get('/status', authController.getAuthStatus);

/**
 * POST /auth/reinitialize
 * Force reinitialize the token manager
 */
router.post('/reinitialize', authController.reinitialize);

/**
 * POST /auth/device
 * Generate device auth credentials (one-time setup)
 */
router.post('/device', authController.generateDeviceAuth);

/**
 * POST /auth/token
 * Get access token using device auth or refresh token
 */
router.post('/token', authController.getAccessToken);

/**
 * GET /auth/verify
 * Verify if an access token is still valid
 */
router.get('/verify', authController.verifyToken);

export default router;
