import { createApp } from './app.js';
import { config } from './config/index.js';
import { prisma } from './db/client.js';
import { initializeJobs } from './jobs/index.js';
import { tokenManager } from './services/epic/token-manager.js';

/**
 * Start the Fortnite Competitive API server
 */

async function startServer() {
  try {
    // Test database connection
    console.log('Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Initialize token manager (if device auth configured)
    if (config.epic.deviceId && config.epic.accountId && config.epic.deviceSecret) {
      try {
        await tokenManager.initialize();
      } catch (error) {
        console.warn('⚠️  Token manager initialization failed:', error);
      }
    }

    // Initialize background jobs
    await initializeJobs();

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.port, () => {
      console.log('');
      console.log('🚀 Fortnite Competitive API is running!');
      console.log('');
      console.log(`📍 Server: http://localhost:${config.port}`);
      console.log(`📍 API Base: http://localhost:${config.port}/api/${config.apiVersion}`);
      console.log(`📍 Health Check: http://localhost:${config.port}/api/${config.apiVersion}/health`);
      console.log('');
      console.log('Available endpoints:');
      console.log(`  POST /api/${config.apiVersion}/auth/device - Generate device auth`);
      console.log(`  POST /api/${config.apiVersion}/auth/token - Get access token`);
      console.log(`  GET  /api/${config.apiVersion}/auth/verify - Verify token`);
      console.log('');
      console.log(`Environment: ${config.nodeEnv}`);
      console.log('');

      // Show device auth status
      if (config.epic.deviceId && config.epic.accountId && config.epic.deviceSecret) {
        console.log('✅ Device auth credentials configured');
      } else {
        console.log('⚠️  Device auth credentials NOT configured');
        console.log('   Run POST /auth/device to generate credentials');
      }
      console.log('');
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      server.close(async () => {
        // Cleanup token manager
        if (tokenManager.isReady()) {
          await tokenManager.logout();
        }
        await prisma.$disconnect();
        console.log('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

startServer();
