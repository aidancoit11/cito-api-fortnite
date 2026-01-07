import { Router } from 'express';
import * as orgController from '../controllers/org.controller.js';

const router = Router();

/**
 * GET /orgs
 * List all organizations
 * Query params: region, limit, offset
 */
router.get('/', orgController.listOrganizations);

/**
 * POST /orgs/sync
 * Sync all orgs from Liquipedia (admin)
 */
router.post('/sync', orgController.syncOrganizations);

/**
 * GET /orgs/:slug
 * Get organization details
 */
router.get('/:slug', orgController.getOrganization);

/**
 * GET /orgs/:slug/roster
 * Get organization roster
 */
router.get('/:slug/roster', orgController.getOrganizationRoster);

/**
 * GET /orgs/:slug/history
 * Get organization tournament history
 */
router.get('/:slug/history', orgController.getOrganizationHistory);

/**
 * GET /orgs/:slug/earnings
 * Get organization earnings summary
 */
router.get('/:slug/earnings', orgController.getOrganizationEarnings);

/**
 * GET /orgs/:slug/earnings/history
 * Get detailed earnings history for organization
 */
router.get('/:slug/earnings/history', orgController.getOrganizationEarningsHistory);

/**
 * POST /orgs/:slug/sync
 * Sync specific org roster (admin)
 */
router.post('/:slug/sync', orgController.syncOrganizationRoster);

/**
 * POST /orgs/:slug/sync-earnings
 * Sync earnings for all players in org (admin)
 */
router.post('/:slug/sync-earnings', orgController.syncOrganizationEarnings);

export default router;
