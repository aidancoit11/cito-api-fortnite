import { Router } from 'express';
import authRoutes from './auth.routes.js';
import orgRoutes from './org.routes.js';
import transferRoutes from './transfer.routes.js';

const router = Router();

/**
 * API Routes
 * Version: v1
 */

// Auth routes
router.use('/auth', authRoutes);

// Organization routes
router.use('/orgs', orgRoutes);

// Transfer routes
router.use('/transfers', transferRoutes);

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
