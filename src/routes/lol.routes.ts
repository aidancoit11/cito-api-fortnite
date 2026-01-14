import { Router } from 'express';

// Import all controllers (will be created by agents)
import * as leagueController from '../controllers/lol-league.controller.js';
import * as teamController from '../controllers/lol-team.controller.js';
import * as playerController from '../controllers/lol-player.controller.js';
import * as tournamentController from '../controllers/lol-tournament.controller.js';
import * as matchController from '../controllers/lol-match.controller.js';
import * as liveController from '../controllers/lol-live.controller.js';
import * as leaderboardController from '../controllers/lol-leaderboard.controller.js';
import * as scheduleController from '../controllers/lol-schedule.controller.js';
import * as transferController from '../controllers/lol-transfer.controller.js';
import * as championController from '../controllers/lol-champion.controller.js';
import * as analyticsController from '../controllers/lol-analytics.controller.js';
import * as recordsController from '../controllers/lol-records.controller.js';
import * as searchController from '../controllers/lol-search.controller.js';
import * as staticController from '../controllers/lol-static.controller.js';
import * as fantasyController from '../controllers/lol-fantasy.controller.js';

const router = Router();

// ============================================================
// 1. LEAGUES & REGIONS (5 endpoints)
// ============================================================

// GET /lol/leagues - Get all leagues
router.get('/leagues', leagueController.getAllLeagues);

// GET /lol/leagues/:leagueId - Get league details
router.get('/leagues/:leagueId', leagueController.getLeagueById);

// GET /lol/leagues/:leagueId/standings - Get league standings
router.get('/leagues/:leagueId/standings', leagueController.getLeagueStandings);

// GET /lol/leagues/:leagueId/schedule - Get league schedule
router.get('/leagues/:leagueId/schedule', leagueController.getLeagueSchedule);

// GET /lol/leagues/:leagueId/history - Get league history
router.get('/leagues/:leagueId/history', leagueController.getLeagueHistory);

// GET /lol/leagues/:leagueId/teams - Get teams in league
router.get('/leagues/:leagueId/teams', leagueController.getLeagueTeams);

// ============================================================
// 2. TOURNAMENTS (9 endpoints)
// ============================================================

// GET /lol/tournaments - List tournaments
router.get('/tournaments', tournamentController.getAllTournaments);

// GET /lol/tournaments/:tournamentId - Get tournament details
router.get('/tournaments/:tournamentId', tournamentController.getTournamentById);

// GET /lol/tournaments/:tournamentId/standings - Get tournament standings
router.get('/tournaments/:tournamentId/standings', tournamentController.getTournamentStandings);

// GET /lol/tournaments/:tournamentId/bracket - Get tournament bracket
router.get('/tournaments/:tournamentId/bracket', tournamentController.getTournamentBracket);

// GET /lol/tournaments/:tournamentId/matches - Get tournament matches
router.get('/tournaments/:tournamentId/matches', tournamentController.getTournamentMatches);

// GET /lol/tournaments/:tournamentId/results - Get tournament results
router.get('/tournaments/:tournamentId/results', tournamentController.getTournamentResults);

// GET /lol/tournaments/:tournamentId/stats - Get tournament stats
router.get('/tournaments/:tournamentId/stats', tournamentController.getTournamentStats);

// GET /lol/tournaments/:tournamentId/mvp - Get tournament MVP
router.get('/tournaments/:tournamentId/mvp', tournamentController.getTournamentMVP);

// ============================================================
// 3. TEAMS / ORGANIZATIONS (10 endpoints)
// ============================================================

// GET /lol/teams - List teams
router.get('/teams', teamController.getAllTeams);

// GET /lol/teams/:slug - Get team details
router.get('/teams/:slug', teamController.getTeamBySlug);

// GET /lol/teams/:slug/roster - Get team roster
router.get('/teams/:slug/roster', teamController.getTeamRoster);

// GET /lol/teams/:slug/roster/history - Get roster history
router.get('/teams/:slug/roster/history', teamController.getTeamRosterHistory);

// GET /lol/teams/:slug/matches - Get team matches
router.get('/teams/:slug/matches', teamController.getTeamMatches);

// GET /lol/teams/:slug/stats - Get team stats
router.get('/teams/:slug/stats', teamController.getTeamStats);

// GET /lol/teams/:slug/h2h/:opponentSlug - Get head-to-head
router.get('/teams/:slug/h2h/:opponentSlug', teamController.getTeamHeadToHead);

// GET /lol/teams/:slug/earnings - Get team earnings
router.get('/teams/:slug/earnings', teamController.getTeamEarnings);

// GET /lol/teams/:slug/achievements - Get team achievements
router.get('/teams/:slug/achievements', teamController.getTeamAchievements);

// GET /lol/teams/:slug/champions - Get team champion pool
router.get('/teams/:slug/champions', teamController.getTeamChampionPool);

// ============================================================
// 4. PLAYERS (14 endpoints)
// ============================================================

// GET /lol/players - List players
router.get('/players', playerController.getAllPlayers);

// GET /lol/players/search - Search players
router.get('/players/search', playerController.searchPlayers);

// GET /lol/players/:playerId - Get player details
router.get('/players/:playerId', playerController.getPlayerById);

// GET /lol/players/:playerId/stats - Get player stats
router.get('/players/:playerId/stats', playerController.getPlayerStats);

// GET /lol/players/:playerId/stats/career - Get career stats
router.get('/players/:playerId/stats/career', playerController.getPlayerCareerStats);

// GET /lol/players/:playerId/earnings - Get player earnings
router.get('/players/:playerId/earnings', playerController.getPlayerEarnings);

// GET /lol/players/:playerId/earnings/summary - Get earnings summary
router.get('/players/:playerId/earnings/summary', playerController.getPlayerEarningsSummary);

// GET /lol/players/:playerId/teams - Get team history
router.get('/players/:playerId/teams', playerController.getPlayerTeamHistory);

// GET /lol/players/:playerId/matches - Get player matches
router.get('/players/:playerId/matches', playerController.getPlayerMatches);

// GET /lol/players/:playerId/champions - Get player champions
router.get('/players/:playerId/champions', playerController.getPlayerChampions);

// GET /lol/players/:playerId/achievements - Get player achievements
router.get('/players/:playerId/achievements', playerController.getPlayerAchievements);

// GET /lol/players/:playerId/compare/:otherPlayerId - Compare players
router.get('/players/:playerId/compare/:otherPlayerId', playerController.comparePlayer);

// GET /lol/players/:playerId/peers - Get similar players
router.get('/players/:playerId/peers', playerController.getPlayerPeers);

// ============================================================
// 5. LEADERBOARDS (8 endpoints)
// ============================================================

// GET /lol/leaderboards/earnings - Top earners
router.get('/leaderboards/earnings', leaderboardController.getTopEarners);

// GET /lol/leaderboards/kda - KDA leaderboard
router.get('/leaderboards/kda', leaderboardController.getKdaLeaderboard);

// GET /lol/leaderboards/cs - CS leaderboard
router.get('/leaderboards/cs', leaderboardController.getCsLeaderboard);

// GET /lol/leaderboards/winrate - Win rate leaderboard
router.get('/leaderboards/winrate', leaderboardController.getWinRateLeaderboard);

// GET /lol/leaderboards/vision - Vision score leaderboard
router.get('/leaderboards/vision', leaderboardController.getVisionLeaderboard);

// GET /lol/leaderboards/firstblood - First blood leaderboard
router.get('/leaderboards/firstblood', leaderboardController.getFirstBloodLeaderboard);

// GET /lol/leaderboards/damage - Damage leaderboard
router.get('/leaderboards/damage', leaderboardController.getDamageLeaderboard);

// GET /lol/leaderboards/championships - Most championships
router.get('/leaderboards/championships', leaderboardController.getMostChampionships);

// ============================================================
// 6. MATCHES (4 endpoints)
// ============================================================

// GET /lol/matches/:matchId - Get match details
router.get('/matches/:matchId', matchController.getMatchById);

// GET /lol/matches/:matchId/games - Get match games
router.get('/matches/:matchId/games', matchController.getMatchGames);

// GET /lol/matches/:matchId/stats - Get match stats
router.get('/matches/:matchId/stats', matchController.getMatchStats);

// GET /lol/matches/:matchId/timeline - Get match timeline
router.get('/matches/:matchId/timeline', matchController.getMatchTimeline);

// ============================================================
// 7. GAMES (6 endpoints)
// ============================================================

// GET /lol/games/:gameId - Get game details
router.get('/games/:gameId', matchController.getGameById);

// GET /lol/games/:gameId/stats - Get game stats
router.get('/games/:gameId/stats', matchController.getGameStats);

// GET /lol/games/:gameId/timeline - Get game timeline
router.get('/games/:gameId/timeline', matchController.getGameTimeline);

// GET /lol/games/:gameId/builds - Get game builds
router.get('/games/:gameId/builds', matchController.getGameBuilds);

// GET /lol/games/:gameId/gold - Get gold graph
router.get('/games/:gameId/gold', matchController.getGameGoldGraph);

// GET /lol/games/:gameId/objectives - Get objectives timeline
router.get('/games/:gameId/objectives', matchController.getGameObjectives);

// ============================================================
// 8. LIVE DATA (7 endpoints)
// ============================================================

// GET /lol/live - Get live matches
router.get('/live', liveController.getLiveMatches);

// GET /lol/live/:matchId - Get live match
router.get('/live/:matchId', liveController.getLiveMatch);

// GET /lol/live/:gameId/stats - Get live game stats
router.get('/live/:gameId/stats', liveController.getLiveGameStats);

// GET /lol/live/:gameId/window - Get live game window
router.get('/live/:gameId/window', liveController.getLiveGameWindow);

// GET /lol/live/:gameId/details - Get live game details
router.get('/live/:gameId/details', liveController.getLiveGameDetails);

// GET /lol/live/:gameId/events - Get live game events
router.get('/live/:gameId/events', liveController.getLiveGameEvents);

// ============================================================
// 9. SCHEDULE (5 endpoints)
// ============================================================

// GET /lol/schedule - Get full schedule
router.get('/schedule', scheduleController.getFullSchedule);

// GET /lol/schedule/today - Get today's matches
router.get('/schedule/today', scheduleController.getTodaysMatches);

// GET /lol/schedule/week - Get this week's matches
router.get('/schedule/week', scheduleController.getThisWeeksMatches);

// GET /lol/schedule/upcoming - Get upcoming matches
router.get('/schedule/upcoming', scheduleController.getUpcomingMatches);

// ============================================================
// 10. TRANSFERS (5 endpoints)
// ============================================================

// GET /lol/transfers - Get recent transfers
router.get('/transfers', transferController.getRecentTransfers);

// GET /lol/transfers/:transferId - Get transfer details
router.get('/transfers/:transferId', transferController.getTransferById);

// GET /lol/transfers/player/:playerId - Get player transfer history
router.get('/transfers/player/:playerId', transferController.getPlayerTransferHistory);

// GET /lol/transfers/team/:slug - Get team transfer activity
router.get('/transfers/team/:slug', transferController.getTeamTransferActivity);

// GET /lol/transfers/window/:season - Get transfer window summary
router.get('/transfers/window/:season', transferController.getTransferWindowSummary);

// ============================================================
// 11. CHAMPIONS / META (6 endpoints)
// ============================================================

// GET /lol/champions/stats - Get champion stats
router.get('/champions/stats', championController.getChampionStats);

// GET /lol/champions/meta - Get meta summary
router.get('/champions/meta', championController.getMetaSummary);

// GET /lol/champions/patches/:patch - Get patch changes
router.get('/champions/patches/:patch', championController.getPatchChanges);

// GET /lol/champions/:championId/stats - Get single champion stats
router.get('/champions/:championId/stats', championController.getChampionById);

// GET /lol/champions/:championId/players - Get best players on champion
router.get('/champions/:championId/players', championController.getChampionPlayers);

// GET /lol/champions/:championId/matchups - Get champion matchups
router.get('/champions/:championId/matchups', championController.getChampionMatchups);

// ============================================================
// 12. ANALYTICS (8 endpoints)
// ============================================================

// GET /lol/analytics/players/:playerId/trend - Get player performance trend
router.get('/analytics/players/:playerId/trend', analyticsController.getPlayerPerformanceTrend);

// GET /lol/analytics/teams/:slug/trend - Get team performance trend
router.get('/analytics/teams/:slug/trend', analyticsController.getTeamPerformanceTrend);

// GET /lol/analytics/roles/:role - Get role comparison
router.get('/analytics/roles/:role', analyticsController.getRoleComparison);

// GET /lol/analytics/regions/compare - Get region comparison
router.get('/analytics/regions/compare', analyticsController.getRegionComparison);

// GET /lol/analytics/drafts/:matchId - Get draft analysis
router.get('/analytics/drafts/:matchId', analyticsController.getDraftAnalysis);

// GET /lol/analytics/teams/:slug/win-conditions - Get win conditions
router.get('/analytics/teams/:slug/win-conditions', analyticsController.getTeamWinConditions);

// GET /lol/analytics/players/:playerId/impact - Get player impact score
router.get('/analytics/players/:playerId/impact', analyticsController.getPlayerImpactScore);

// GET /lol/analytics/players/:playerId/clutch - Get clutch factor
router.get('/analytics/players/:playerId/clutch', analyticsController.getClutchFactor);

// ============================================================
// 13. FANTASY (5 endpoints)
// ============================================================

// GET /lol/fantasy/projections/players - Get player projections
router.get('/fantasy/projections/players', fantasyController.getPlayerProjections);

// GET /lol/fantasy/stats/players/:playerId - Get player fantasy stats
router.get('/fantasy/stats/players/:playerId', fantasyController.getPlayerFantasyStats);

// GET /lol/fantasy/optimal - Get optimal lineup
router.get('/fantasy/optimal', fantasyController.getOptimalLineup);

// GET /lol/fantasy/value - Get value picks
router.get('/fantasy/value', fantasyController.getValuePicks);

// ============================================================
// 14. RECORDS & HISTORY (7 endpoints)
// ============================================================

// GET /lol/records - Get all records
router.get('/records', recordsController.getAllRecords);

// GET /lol/records/:category - Get record holders
router.get('/records/:category', recordsController.getRecordHolders);

// GET /lol/records/player/:playerId - Get player records
router.get('/records/player/:playerId', recordsController.getPlayerRecords);

// GET /lol/records/team/:slug - Get team records
router.get('/records/team/:slug', recordsController.getTeamRecords);

// GET /lol/history/:year - Get historical stats
router.get('/history/:year', recordsController.getHistoricalStats);

// GET /lol/history/worlds - Get Worlds champions
router.get('/history/worlds', recordsController.getWorldsChampions);

// GET /lol/history/msi - Get MSI champions
router.get('/history/msi', recordsController.getMsiChampions);

// GET /lol/history/halloffame - Get Hall of Fame
router.get('/history/halloffame', recordsController.getHallOfFame);

// ============================================================
// 15. SEARCH & DISCOVERY (3 endpoints)
// ============================================================

// GET /lol/search - Global search
router.get('/search', searchController.globalSearch);

// GET /lol/autocomplete - Autocomplete
router.get('/autocomplete', searchController.autocomplete);

// GET /lol/trending - Get trending
router.get('/trending', searchController.getTrending);

// ============================================================
// 16. STATIC DATA (6 endpoints)
// ============================================================

// GET /lol/static/champions - Get all champions
router.get('/static/champions', staticController.getChampions);

// GET /lol/static/champions/:championId - Get champion by ID
router.get('/static/champions/:championId', staticController.getChampionById);

// GET /lol/static/items - Get all items
router.get('/static/items', staticController.getItems);

// GET /lol/static/items/:itemId - Get item by ID
router.get('/static/items/:itemId', staticController.getItemById);

// GET /lol/static/patches - Get all patches
router.get('/static/patches', staticController.getPatches);

// GET /lol/static/patches/current - Get current patch
router.get('/static/patches/current', staticController.getCurrentPatch);

// GET /lol/static/regions - Get all regions
router.get('/static/regions', staticController.getRegions);

// GET /lol/static/roles - Get all roles
router.get('/static/roles', staticController.getRoles);

// ============================================================
// 17. API STATUS (4 endpoints)
// ============================================================

// GET /lol/status - Get API status
router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    game: 'league-of-legends',
    version: '1.0.0',
    endpoints: 118,
    lastSync: null, // TODO: Get from DB
  });
});

// GET /lol/status/sync - Get sync status
router.get('/status/sync', async (req, res) => {
  // TODO: Implement sync status
  res.json({
    leagues: { lastSync: null, count: 0 },
    teams: { lastSync: null, count: 0 },
    players: { lastSync: null, count: 0 },
    tournaments: { lastSync: null, count: 0 },
    matches: { lastSync: null, count: 0 },
  });
});

export default router;
