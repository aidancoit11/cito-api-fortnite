import { Router } from 'express';
import authRoutes from './auth.routes.js';
import firebaseAuthRoutes from './firebase-auth.routes.js';
import orgRoutes from './org.routes.js';
import transferRoutes from './transfer.routes.js';
import tournamentRoutes from './tournament.routes.js';
import playerRoutes from './player.routes.js';
import searchRoutes from './search.routes.js';
import killfeedRoutes from './killfeed.routes.js';
import comprehensiveTournamentRoutes from './comprehensive-tournament.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import apiKeysRoutes from './api-keys.routes.js';
import liveEventsRoutes from './live-events.routes.js';
import codRoutes from './cod.routes.js';
import lolRoutes from './lol.routes.js';

const router = Router();

/**
 * API Routes
 * Version: v1
 */

// Auth routes
router.use('/auth', authRoutes);

// Firebase auth routes (dashboard authentication)
router.use('/auth/firebase', firebaseAuthRoutes);

// Organization routes
router.use('/orgs', orgRoutes);

// Player routes
router.use('/players', playerRoutes);

// Transfer routes
router.use('/transfers', transferRoutes);

// Tournament routes
router.use('/tournaments', tournamentRoutes);

// Search routes
router.use('/search', searchRoutes);

// Kill feed routes (tournament replay data)
router.use('/killfeed', killfeedRoutes);

// Comprehensive tournament routes (100% complete tournament data)
router.use('/comprehensive', comprehensiveTournamentRoutes);

// Subscription & billing routes (Stripe integration)
router.use('/subscription', subscriptionRoutes);

// API key management routes
router.use('/api-keys', apiKeysRoutes);

// Live events routes (real-time tournament leaderboards)
router.use('/live-events', liveEventsRoutes);

// Call of Duty esports routes
router.use('/cod', codRoutes);

// League of Legends esports routes
router.use('/lol', lolRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Placeholder for future routes
// router.use('/player', playerRoutes);
// router.use('/events', eventsRoutes);
// router.use('/tournaments', tournamentsRoutes);
// router.use('/esports', esportsRoutes);
// router.use('/transfers', transfersRoutes);
// router.use('/news', newsRoutes);
// router.use('/timeline', timelineRoutes);
// router.use('/status', statusRoutes);

export default router;
