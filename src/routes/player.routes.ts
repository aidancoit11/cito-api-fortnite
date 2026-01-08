import { Router } from 'express';
import * as playerController from '../controllers/player.controller.js';

const router = Router();

/**
 * GET /players
 * Search/list players
 * Query params: q (search), limit, offset, org
 */
router.get('/', playerController.listPlayers);

/**
 * GET /players/top-earners
 * Get top earning players
 * Query params: limit, region
 */
router.get('/top-earners', playerController.getTopEarners);

/**
 * GET /players/:identifier
 * Get player by ID, IGN, or Epic Account ID
 */
router.get('/:identifier', playerController.getPlayer);

/**
 * GET /players/:identifier/earnings
 * Get player's full earnings history
 */
router.get('/:identifier/earnings', playerController.getPlayerEarnings);

/**
 * GET /players/:identifier/tournaments
 * Get player's tournament history
 */
router.get('/:identifier/tournaments', playerController.getPlayerTournaments);

export default router;
