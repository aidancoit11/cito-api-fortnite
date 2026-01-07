import { Router } from 'express';
import * as transferController from '../controllers/transfer.controller.js';

const router = Router();

/**
 * GET /transfers
 * Get recent transfers
 * Query params: limit, offset, org
 */
router.get('/', transferController.getTransfers);

/**
 * POST /transfers/sync
 * Sync transfers from Liquipedia (admin)
 */
router.post('/sync', transferController.syncTransfers);

export default router;
