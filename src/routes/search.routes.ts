import { Router } from 'express';
import * as searchController from '../controllers/search.controller.js';

const router = Router();

/**
 * GET /search
 * Global search across all entities
 * Query params: q (required), type (players|orgs|tournaments|all), limit
 */
router.get('/', searchController.globalSearch);

/**
 * GET /search/autocomplete
 * Quick autocomplete for search suggestions
 * Query params: q (required), limit
 */
router.get('/autocomplete', searchController.autocomplete);

/**
 * GET /search/stats
 * Get database statistics
 */
router.get('/stats', searchController.getStats);

export default router;
