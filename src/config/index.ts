import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Config {
  // Application
  nodeEnv: string;
  port: number;
  apiVersion: string;

  // Epic Games
  epic: {
    accountEmail: string;
    accountPassword: string;
    deviceId?: string;
    accountId?: string;
    deviceSecret?: string;
    clientId: string;
    clientSecret: string;
  };

  // Database
  database: {
    url: string;
  };

  // Supabase
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };

  // Web Scraping
  scraper: {
    userAgent: string;
  };

  // Security
  jwtSecret: string;
  apiKey?: string;

  // Rate Limiting
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };

  // Caching
  cache: {
    ttlSeconds: number;
    maxSize: number;
  };

  // Logging
  logging: {
    level: string;
    filePath: string;
  };

  // Cron Jobs
  cron: {
    tokenRefresh: boolean;
    tournamentScraper: boolean;
    rosterScraper: boolean;
    transferScraper: boolean;
    statsRefresh: boolean;
    earningsAggregator: boolean;
  };

  // Stripe (payments)
  stripe: {
    secretKey: string;
    webhookSecret: string;
    prices: {
      developer: string;
      business: string;
    };
  };

  // Firebase
  firebase: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  };

  // External Services (optional)
  sentry?: {
    dsn: string;
  };
  discord?: {
    webhookUrl: string;
  };

  // Development
  debug: boolean;
  mockEpicApi: boolean;
}

const getEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
};

const getEnvOptional = (key: string, defaultValue?: string): string | undefined => {
  return process.env[key] || defaultValue;
};

const getEnvBoolean = (key: string, defaultValue: boolean = false): boolean => {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
};

const getEnvNumber = (key: string, defaultValue: number): number => {
  const value = process.env[key];
  if (!value) return defaultValue;
  return parseInt(value, 10);
};

export const config: Config = {
  nodeEnv: getEnv('NODE_ENV', 'development'),
  port: getEnvNumber('PORT', 3000),
  apiVersion: getEnv('API_VERSION', 'v1'),

  epic: {
    accountEmail: getEnv('EPIC_ACCOUNT_EMAIL'),
    accountPassword: getEnv('EPIC_ACCOUNT_PASSWORD'),
    deviceId: getEnvOptional('EPIC_DEVICE_ID'),
    accountId: getEnvOptional('EPIC_ACCOUNT_ID'),
    deviceSecret: getEnvOptional('EPIC_DEVICE_SECRET'),
    clientId: getEnv('EPIC_CLIENT_ID'),
    clientSecret: getEnv('EPIC_CLIENT_SECRET'),
  },

  database: {
    url: getEnv('DATABASE_URL'),
  },

  supabase: {
    url: getEnv('SUPABASE_URL'),
    anonKey: getEnv('SUPABASE_ANON_KEY'),
    serviceRoleKey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  },

  scraper: {
    userAgent: getEnv(
      'SCRAPER_USER_AGENT',
      'Mozilla/5.0 (compatible; FortniteCompetitiveAPI/1.0; +https://yourdomain.com)'
    ),
  },

  jwtSecret: getEnv('JWT_SECRET'),
  apiKey: getEnvOptional('API_KEY'),

  rateLimit: {
    windowMs: getEnvNumber('RATE_LIMIT_WINDOW_MS', 900000), // 15 minutes
    maxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100),
  },

  cache: {
    ttlSeconds: getEnvNumber('CACHE_TTL_SECONDS', 3600), // 1 hour
    maxSize: getEnvNumber('CACHE_MAX_SIZE', 1000),
  },

  logging: {
    level: getEnv('LOG_LEVEL', 'info'),
    filePath: getEnv('LOG_FILE_PATH', './logs/api.log'),
  },

  cron: {
    tokenRefresh: getEnvBoolean('ENABLE_TOKEN_REFRESH', true),
    tournamentScraper: getEnvBoolean('ENABLE_TOURNAMENT_SCRAPER', true),
    rosterScraper: getEnvBoolean('ENABLE_ROSTER_SCRAPER', true),
    transferScraper: getEnvBoolean('ENABLE_TRANSFER_SCRAPER', true),
    statsRefresh: getEnvBoolean('ENABLE_STATS_REFRESH', true),
    earningsAggregator: getEnvBoolean('ENABLE_EARNINGS_AGGREGATOR', true),
  },

  stripe: {
    secretKey: getEnvOptional('STRIPE_SECRET_KEY') || '',
    webhookSecret: getEnvOptional('STRIPE_WEBHOOK_SECRET') || '',
    prices: {
      developer: getEnvOptional('STRIPE_PRICE_DEVELOPER') || '', // $29/month
      business: getEnvOptional('STRIPE_PRICE_BUSINESS') || '', // $99/month
    },
  },

  firebase: {
    projectId: getEnvOptional('FIREBASE_PROJECT_ID') || '',
    clientEmail: getEnvOptional('FIREBASE_CLIENT_EMAIL') || '',
    privateKey: (getEnvOptional('FIREBASE_PRIVATE_KEY') || '').replace(/\\n/g, '\n'),
  },

  sentry: process.env.SENTRY_DSN
    ? {
        dsn: process.env.SENTRY_DSN,
      }
    : undefined,

  discord: process.env.DISCORD_WEBHOOK_URL
    ? {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL,
      }
    : undefined,

  debug: getEnvBoolean('DEBUG', false),
  mockEpicApi: getEnvBoolean('MOCK_EPIC_API', false),
};
