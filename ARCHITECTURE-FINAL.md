# Fortnite Competitive API - Final Architecture (Web Scraping Only)

## ✅ APPROVED & READY TO BUILD

---

## Data Sources (Updated - No Paid APIs)

### Primary: Epic Games Hidden API
**Source:** [LeleDerGrasshalmi/FortniteEndpointsDocumentation](https://github.com/LeleDerGrasshalmi/FortniteEndpointsDocumentation)

- **Authentication**: OAuth with device auth + automatic token refresh
- **Player Stats**: Stats Proxy Service
- **Competitive Events**: Events Service (leaderboards, top 500, match data)
- **Game Content**: Timeline, news, server status

### Secondary: Web Scraping (Cheerio)

| Source | What We Scrape | Update Frequency |
|--------|----------------|------------------|
| **Esports Earnings** | Player earnings, team earnings, tournament prizes | Daily |
| **Liquipedia** | Team rosters, org info, player transfers, tournament brackets | Every 2 days |
| **Fortnite Competitive** | Upcoming FNCS tournaments, event schedules | Weekly |
| **FortniteTracker** | Organization leaderboards, roster data | Every 2 days |

**No API keys needed - 100% free, no rate limits, perfect for commercial use!**

---

## API Endpoints (All 34 Endpoints - Same as Before)

### Phase 1: Core Player Data
| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 1 | `/auth/device` | POST | Generate device auth credentials |
| 2 | `/auth/token` | POST | Get access token |
| 3 | `/player/search` | GET | Search for players by name/username |
| 4 | `/player/lookup` | GET | Lookup player by exact username → accountId |
| 5 | `/player/{accountId}/stats` | GET | Get BR stats (wins, kills, K/D, matches) |
| 6 | `/player/{accountId}/profile` | GET | Full player profile (stats + tournaments + earnings + current org) |

### Phase 2: Player Tournament History
| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 7 | `/player/{accountId}/tournaments` | GET | Complete tournament history for a player |
| 8 | `/player/{accountId}/earnings` | GET | **Earnings breakdown (scraped from Esports Earnings)** |
| 9 | `/player/{accountId}/tournaments/{tournamentId}/matches` | GET | Match-by-match stats for player in specific tournament |

### Phase 3: Game Info & Timeline
| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 10 | `/news` | GET | Current competitive/esports news |
| 11 | `/timeline` | GET | Season timeline, chapter/season info, active events, map changes |
| 12 | `/status` | GET | Fortnite server status |

### Phase 4: Competitive Events (Epic Games)
| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 13 | `/events/active` | GET | Currently active tournaments |
| 14 | `/events/{eventId}` | GET | Event details |
| 15 | `/events/{eventId}/leaderboard` | GET | Top 500 leaderboard for event |
| 16 | `/events/{eventId}/player/{accountId}` | GET | Specific player's performance in event |

### Phase 5: Tournament Results
| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 17 | `/tournaments/upcoming` | GET | **All upcoming tournaments (scraped from Fortnite Competitive + Liquipedia)** |
| 18 | `/tournaments/{id}` | GET | Tournament details |
| 19 | `/tournaments/{id}/results` | GET | Top 500 final results with account IDs |
| 20 | `/tournaments/{id}/matches` | GET | All match results for tournament |
| 21 | `/tournaments/{id}/schedule` | GET | **Match schedule (scraped from Liquipedia)** |
| 22 | `/tournaments/calendar` | GET | Monthly tournament calendar |

### Phase 6: Esports Earnings Data (Scraped)
| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 23 | `/esports/players` | GET | **Top earning Fortnite players (scraped from Esports Earnings)** |
| 24 | `/esports/players/{playerId}` | GET | **Player earnings details (scraped from Esports Earnings)** |
| 25 | `/esports/teams` | GET | **Top earning teams (scraped from Esports Earnings)** |
| 26 | `/esports/tournaments` | GET | **Recent tournaments (scraped from Esports Earnings + Liquipedia)** |
| 27 | `/esports/tournaments/{id}` | GET | **Tournament results (scraped from Esports Earnings)** |

### Phase 7: Organizations & Rosters (Scraped)
| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 28 | `/orgs` | GET | **List all esports organizations (scraped from Liquipedia + FortniteTracker)** |
| 29 | `/orgs/{orgSlug}` | GET | **Organization details (scraped from Liquipedia)** |
| 30 | `/orgs/{orgSlug}/roster` | GET | **Current team roster (scraped from Liquipedia + FortniteTracker)** |
| 31 | `/orgs/{orgSlug}/history` | GET | **Organization tournament history (scraped from Liquipedia)** |

### Phase 8: Player Transfers (Scraped)
| # | Endpoint | Method | Description |
|---|----------|--------|-------------|
| 32 | `/transfers/recent` | GET | **Recent player transfers (scraped from Liquipedia)** |
| 33 | `/transfers/{playerId}` | GET | **Transfer history for specific player (scraped from Liquipedia)** |
| 34 | `/transfers/{orgSlug}` | GET | **Transfer history for organization (scraped from Liquipedia)** |

---

## Updated File Structure

```
cito-api-fortnite/
├── src/
│   ├── services/
│   │   ├── epic/
│   │   │   ├── auth.service.ts
│   │   │   ├── account.service.ts
│   │   │   ├── stats.service.ts
│   │   │   ├── fortnite.service.ts
│   │   │   ├── events.service.ts
│   │   │   └── token-manager.service.ts
│   │   │
│   │   ├── scrapers/                      ✨ UPDATED
│   │   │   ├── earnings.scraper.ts        # Scrape Esports Earnings
│   │   │   ├── liquipedia.scraper.ts      # Scrape Liquipedia (rosters, orgs, transfers)
│   │   │   ├── fortnite-tracker.scraper.ts # Scrape FortniteTracker (org rosters)
│   │   │   ├── tournament.scraper.ts      # Scrape upcoming tournaments
│   │   │   ├── results.scraper.ts         # Tournament results
│   │   │   ├── matches.scraper.ts         # Match data
│   │   │   ├── roster.scraper.ts          # Team rosters
│   │   │   ├── transfer.scraper.ts        # Player transfers
│   │   │   ├── org.scraper.ts             # Organization metadata
│   │   │   └── timeline.scraper.ts        # Season timeline
│   │   │
│   │   └── aggregators/
│   │       ├── player-earnings.ts
│   │       └── player-history.ts
```

---

## Scraping Targets & URLs

### Esports Earnings
```
Base URL: https://www.esportsearnings.com

Pages to scrape:
- /games/577-fortnite/top-players (Top players)
- /players/{player-id} (Player earnings details)
- /games/577-fortnite/top-teams (Top teams)
- /games/577-fortnite/tournaments (Recent tournaments)
- /tournaments/{tournament-id} (Tournament results)

Scraping Strategy:
- Use Cheerio to parse HTML tables
- Extract player names, earnings, tournament counts
- Match player names to Epic account IDs via /player/search
- Cache results in Supabase for 24 hours
```

### Liquipedia
```
Base URL: https://liquipedia.net/fortnite

Pages to scrape:
- /Portal:Teams (All organizations)
- /{team-name} (Team page with roster)
- /Portal:Transfers (Recent transfers)
- /{tournament-name} (Tournament brackets & schedules)

Scraping Strategy:
- Use Cheerio to parse wiki tables
- Extract rosters, player names, join dates
- Extract transfer data (from org, to org, date)
- Match player names to Epic account IDs
- Cache results for 2 days
```

### FortniteTracker
```
Base URL: https://fortnitetracker.com/esports

Pages to scrape:
- /organization/{org-slug} (Org roster with account IDs)

Scraping Strategy:
- Direct account ID mapping (best source)
- Extract player stats, PR points
- Cache results for 2 days
```

---

## Updated Scheduled Jobs

| Job | Frequency | Purpose |
|-----|-----------|---------|
| **Token Refresh** | Every 4 hours | Refresh OAuth token (CRITICAL) |
| **Earnings Scraper** | **Daily at 02:00** | Scrape Esports Earnings for player/team earnings |
| **Liquipedia Roster Scraper** | **Every 2 days** | Scrape team rosters, org data |
| **Liquipedia Transfer Scraper** | **Every 2 days** | Scrape player transfers |
| **FortniteTracker Roster Scraper** | **Every 2 days** | Scrape org rosters with account IDs |
| **Tournament Scraper** | Every 7 days | Scrape upcoming tournaments |
| **Tournament Results Scraper** | After event ends | Fetch top 500 from Epic API |
| **Match Data Scraper** | After event ends | Fetch match-by-match data |
| **Stats Cache Refresh** | Every 1 hour | Update player stats cache |
| **Timeline Scraper** | Every 6 hours | Update season timeline |

---

## Updated Build Order

### Phase 1: Setup & Auth (Steps 1-7)
1. Project setup
2. Supabase schema
3. `/auth/device`
4. `/auth/token`
5. Token manager service
6. Token refresh job
7. Epic auth middleware

### Phase 2: Player Data (Steps 8-14)
8. `/player/search`
9. `/player/lookup`
10. `/player/{id}/stats`
11. `/player/{id}/profile`
12. `/player/{id}/tournaments`
13. `/player/{id}/earnings` (with earnings scraper)
14. `/player/{id}/tournaments/{id}/matches`

### Phase 3: Game Info (Steps 15-17)
15. `/news`
16. `/timeline`
17. `/status`

### Phase 4: Events (Steps 18-21)
18. `/events/active`
19. `/events/{id}`
20. `/events/{id}/leaderboard`
21. `/events/{id}/player/{id}`

### Phase 5: Tournaments (Steps 22-27)
22. `/tournaments/upcoming`
23. `/tournaments/{id}`
24. `/tournaments/{id}/results`
25. `/tournaments/{id}/matches`
26. `/tournaments/{id}/schedule`
27. `/tournaments/calendar`

### Phase 6: Esports Earnings (Steps 28-32) ✨ WITH SCRAPING
28. **Earnings scraper** (Esports Earnings scraper)
29. `/esports/players` (uses scraped data)
30. `/esports/players/{id}` (uses scraped data)
31. `/esports/teams` (uses scraped data)
32. `/esports/tournaments` (uses scraped data)
33. `/esports/tournaments/{id}` (uses scraped data)

### Phase 7: Organizations (Steps 34-37) ✨ WITH SCRAPING
34. **Liquipedia org scraper** (scrape org data)
35. **FortniteTracker roster scraper** (scrape rosters with account IDs)
36. `/orgs` (uses scraped data)
37. `/orgs/{slug}` (uses scraped data)
38. `/orgs/{slug}/roster` (uses scraped data)
39. `/orgs/{slug}/history` (uses scraped data)

### Phase 8: Transfers (Steps 40-42) ✨ WITH SCRAPING
40. **Liquipedia transfer scraper** (scrape transfer data)
41. `/transfers/recent` (uses scraped data)
42. `/transfers/{playerId}` (uses scraped data)
43. `/transfers/{orgSlug}` (uses scraped data)

### Phase 9: All Scheduled Jobs (Steps 44-52)
44. Token refresh job (every 4 hours)
45. Earnings scraper job (daily)
46. Liquipedia roster scraper (every 2 days)
47. Liquipedia transfer scraper (every 2 days)
48. FortniteTracker roster scraper (every 2 days)
49. Tournament scraper (weekly)
50. Results scraper (triggered)
51. Match data scraper (triggered)
52. Stats refresh (hourly)
53. Timeline scraper (every 6 hours)

---

## Environment Variables Needed

### ✅ Already Set in .env
```bash
EPIC_ACCOUNT_EMAIL=copiousgrit1@gmail.com
EPIC_ACCOUNT_PASSWORD=Aidancoit7177$
EPIC_CLIENT_ID=ec684b8c687f479fadea3cb2ad83f5c6
EPIC_CLIENT_SECRET=e1f31c211f28413186262d37a13fc84d
SUPABASE_URL=https://jbvyvutdqbjgjsduarwm.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### ⚠️ Still Need to Set
```bash
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.jbvyvutdqbjgjsduarwm.supabase.co:5432/postgres
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

### ✅ No API Keys Needed
- ❌ ESPORTS_EARNINGS_API_KEY (removed - we scrape instead)
- ❌ LIQUIPEDIA_API_KEY (removed - we scrape instead)
- ✅ SCRAPER_USER_AGENT (already set)

---

## Advantages of Web Scraping Approach

### ✅ Pros
1. **No API costs** - 100% free, perfect for commercial use
2. **No rate limits** - Only limited by respectful scraping practices
3. **More data** - Access to all public data, not just API endpoints
4. **Full control** - We control the scraping schedule and data freshness
5. **No API keys to manage** - One less security concern

### ⚠️ Cons & Mitigations
1. **Scraping may break if website changes**
   - Mitigation: Monitor scraper jobs, set up alerts for failures
   - Store scraped HTML in database for debugging

2. **Slower than API calls**
   - Mitigation: Cache aggressively (24-48 hours)
   - Run scrapers on schedule, not on-demand

3. **Potential IP blocking**
   - Mitigation: Respectful scraping (1 request per 3 seconds)
   - Rotate user agents
   - Use DigitalOcean App Platform IP (professional hosting)

---

## Tech Stack (No Changes)

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: Supabase (PostgreSQL)
- **ORM**: Prisma
- **HTTP Client**: Axios
- **Scraping**: Cheerio ✨ (primary tool)
- **Scheduling**: node-cron
- **Caching**: node-cache
- **Rate Limiting**: express-rate-limit
- **Validation**: Zod
- **Logging**: Winston
- **Testing**: Vitest

---

## Summary

**Total Endpoints**: 34 (unchanged)
**Total Build Steps**: 53 (increased from 48 due to scraper jobs)
**API Keys Required**: 0 (down from 2)
**Cost**: $0/month (down from ~$50-100/month for paid APIs)

**All endpoints remain the same - we just get the data from web scraping instead of paid APIs!**

---

## ✅ Ready to Build!

Once you:
1. Get your Supabase database password for `DATABASE_URL`
2. Generate `JWT_SECRET`

We can start building! Say "Ready to build" and we'll begin with **Step 1: Project Setup**.
