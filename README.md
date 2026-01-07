# Fortnite Competitive API

A comprehensive REST API for Fortnite competitive esports data, providing player stats, tournament results, earnings tracking, team rosters, and organization information.

## Features

- **Player Data**: Search players, view stats, tournament history, and earnings
- **Competitive Events**: Live tournament leaderboards, top 500 tracking, match-by-match stats
- **Tournament System**: Upcoming tournaments, results, schedules, and calendars
- **Esports Earnings**: Player and team earnings data (web scraped)
- **Organizations**: Team rosters, org details, tournament history
- **Player Transfers**: Track player movements between organizations
- **Automatic Token Refresh**: Never worry about Epic OAuth token expiration

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **ORM**: Prisma
- **Web Scraping**: Cheerio
- **Caching**: node-cache
- **Scheduling**: node-cron
- **Validation**: Zod
- **Logging**: Winston

## Getting Started

### Prerequisites

- Node.js 20 or higher
- Supabase account (Pro recommended)
- Burner Epic Games account (no 2FA)

### Installation

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Start development server
npm run dev
```

### Environment Setup

See [SETUP-EPIC-AUTH.md](./SETUP-EPIC-AUTH.md) for detailed setup instructions.

Required environment variables in `.env`:
- `EPIC_ACCOUNT_EMAIL` - Burner Epic account
- `EPIC_ACCOUNT_PASSWORD` - Account password
- `DATABASE_URL` - Supabase PostgreSQL connection
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `JWT_SECRET` - Random secret for JWT signing

## API Endpoints

### Authentication
- `POST /api/v1/auth/device` - Generate device auth
- `POST /api/v1/auth/token` - Get access token

### Players
- `GET /api/v1/player/search` - Search players
- `GET /api/v1/player/lookup` - Lookup player by username
- `GET /api/v1/player/:id/stats` - Player stats
- `GET /api/v1/player/:id/profile` - Complete player profile
- `GET /api/v1/player/:id/tournaments` - Tournament history
- `GET /api/v1/player/:id/earnings` - Earnings breakdown
- `GET /api/v1/player/:id/tournaments/:tournamentId/matches` - Match stats

### Events
- `GET /api/v1/events/active` - Active tournaments
- `GET /api/v1/events/:id` - Event details
- `GET /api/v1/events/:id/leaderboard` - Top 500 leaderboard
- `GET /api/v1/events/:id/player/:accountId` - Player performance

### Tournaments
- `GET /api/v1/tournaments/upcoming` - Upcoming tournaments
- `GET /api/v1/tournaments/:id` - Tournament details
- `GET /api/v1/tournaments/:id/results` - Top 500 results
- `GET /api/v1/tournaments/:id/matches` - Match results
- `GET /api/v1/tournaments/:id/schedule` - Match schedule
- `GET /api/v1/tournaments/calendar` - Tournament calendar

### Esports
- `GET /api/v1/esports/players` - Top earning players
- `GET /api/v1/esports/players/:id` - Player earnings
- `GET /api/v1/esports/teams` - Top earning teams
- `GET /api/v1/esports/tournaments` - Recent tournaments
- `GET /api/v1/esports/tournaments/:id` - Tournament results

### Organizations
- `GET /api/v1/orgs` - List organizations
- `GET /api/v1/orgs/:slug` - Organization details
- `GET /api/v1/orgs/:slug/roster` - Team roster
- `GET /api/v1/orgs/:slug/history` - Tournament history

### Transfers
- `GET /api/v1/transfers/recent` - Recent transfers
- `GET /api/v1/transfers/:playerId` - Player transfer history
- `GET /api/v1/transfers/:orgSlug` - Organization transfers

### Game Info
- `GET /api/v1/news` - Competitive news
- `GET /api/v1/timeline` - Season timeline
- `GET /api/v1/status` - Server status

## Scheduled Jobs

- **Token Refresh**: Every 4 hours (prevents token expiration)
- **Earnings Scraper**: Daily at 02:00
- **Roster Scraper**: Every 2 days
- **Transfer Scraper**: Every 2 days
- **Tournament Scraper**: Weekly
- **Stats Refresh**: Hourly
- **Timeline Scraper**: Every 6 hours

## Development

```bash
# Run in watch mode
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format

# View database
npm run prisma:studio
```

## Deployment

This API is designed to run on DigitalOcean App Platform with automatic deployment from GitHub.

### Deployment Checklist
- [ ] Set all environment variables in DigitalOcean
- [ ] Run database migrations
- [ ] Generate device auth credentials
- [ ] Enable all cron jobs
- [ ] Set up monitoring/alerts

## Architecture

See [ARCHITECTURE-FINAL.md](./ARCHITECTURE-FINAL.md) for complete architecture documentation.

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
