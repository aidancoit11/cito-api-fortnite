import { Router } from 'express';
import * as tournamentController from '../controllers/tournament.controller.js';

const router = Router();

/**
 * GET /tournaments
 * List all tournaments
 * Query params: status (upcoming|ongoing|completed), region, year, tier, limit, offset
 */
router.get('/', tournamentController.listTournaments);

/**
 * GET /tournaments/upcoming
 * Get upcoming tournaments from Epic API and database
 */
router.get('/upcoming', tournamentController.getUpcomingTournaments);

/**
 * GET /tournaments/live
 * Get currently live tournaments with real-time leaderboards
 * Query params: includeLeaderboard (true|false)
 */
router.get('/live', tournamentController.getLiveTournaments);

/**
 * GET /tournaments/past
 * Get completed tournaments (paginated)
 * Query params: region, year, tier, limit, offset
 */
router.get('/past', tournamentController.getPastTournaments);

/**
 * POST /tournaments/sync
 * Sync all tournaments from Liquipedia (admin)
 * Query params: years (comma-separated), scrapeDetails, scrapeResults
 */
router.post('/sync', tournamentController.syncTournaments);

/**
 * POST /tournaments/sync-live
 * Sync all currently live events from Epic API (admin)
 */
router.post('/sync-live', tournamentController.syncLiveEvents);

/**
 * GET /tournaments/live/:eventId/:windowId
 * Get real-time leaderboard for specific live event
 */
router.get('/live/:eventId/:windowId', tournamentController.getLiveEventLeaderboard);

/**
 * GET /tournaments/player/:identifier/history
 * Get player's tournament history across all tournaments
 * Query params: limit
 */
router.get('/player/:identifier/history', tournamentController.getPlayerTournamentHistory);

/**
 * GET /tournaments/org/:slug/history
 * Get organization's tournament history (all players from that org)
 * Query params: limit
 */
router.get('/org/:slug/history', tournamentController.getOrgTournamentHistory);

/**
 * GET /tournaments/:id
 * Get tournament details with top results
 */
router.get('/:id', tournamentController.getTournament);

/**
 * GET /tournaments/:id/results
 * Get full tournament results (top 500)
 * Query params: limit, offset
 */
router.get('/:id/results', tournamentController.getTournamentResults);

/**
 * GET /tournaments/:id/matches
 * Get match-by-match breakdown for tournament
 * Query params: limit, offset
 */
router.get('/:id/matches', tournamentController.getTournamentMatches);

/**
 * GET /tournaments/:id/player/:accountId
 * Get specific player's performance in tournament
 */
router.get('/:id/player/:accountId', tournamentController.getPlayerTournamentStats);

/**
 * POST /tournaments/:id/sync
 * Sync results for a specific tournament (admin)
 */
router.post('/:id/sync', tournamentController.syncTournamentResults);

export default router;
