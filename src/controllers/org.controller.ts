import { Request, Response, NextFunction } from 'express';
import { orgService } from '../services/scraper/org.service.js';
import { earningsService } from '../services/scraper/earnings.service.js';
import { prisma } from '../db/client.js';

/**
 * GET /orgs
 * List all organizations
 */
export async function listOrganizations(req: Request, res: Response, next: NextFunction) {
  try {
    const { region, limit = '50', offset = '0' } = req.query;

    const orgs = await orgService.listOrgs({
      region: region as string | undefined,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    res.json({
      success: true,
      count: orgs.length,
      data: orgs,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /orgs/:slug
 * Get organization details
 */
export async function getOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { slug } = req.params;

    if (!slug) {
      res.status(400).json({ success: false, error: 'Slug is required' });
      return;
    }

    const org = await orgService.getOrg(slug);

    if (!org) {
      res.status(404).json({
        success: false,
        error: 'Organization not found',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        slug: org.slug,
        name: org.name,
        logoUrl: org.logoUrl,
        region: org.region,
        description: org.description,
        socialMedia: org.socialMedia,
        wikiUrl: org.wikiUrl,
        websiteUrl: org.websiteUrl,
        foundedDate: org.foundedDate,
        disbandedDate: org.disbandedDate,
        headquarters: org.headquarters,
        approxTotalWinnings: org.approxTotalWinnings,
        rosterCount: org.roster.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /orgs/:slug/roster
 * Get organization roster
 * Query params: includeFormer (boolean) - include former members
 */
export async function getOrganizationRoster(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { slug } = req.params;
    const { includeFormer = 'false' } = req.query;

    if (!slug) {
      res.status(400).json({ success: false, error: 'Slug is required' });
      return;
    }

    const includeFrmr = includeFormer === 'true' || includeFormer === '1';
    const org = await orgService.getOrg(slug, { includeFormer: includeFrmr });

    if (!org) {
      res.status(404).json({
        success: false,
        error: 'Organization not found',
      });
      return;
    }

    // Get roster counts
    const counts = await orgService.getRosterCounts(slug);

    // Separate current and former
    const currentRoster = org.roster.filter(r => r.status === 'current');
    const formerRoster = org.roster.filter(r => r.status === 'former');

    // Group current roster by role
    const currentPlayers = currentRoster.filter(r => r.role === 'Player');
    const currentCoaches = currentRoster.filter(r => r.role === 'Coach');
    const currentStaff = currentRoster.filter(r => !['Player', 'Coach'].includes(r.role));

    const responseData: any = {
      orgSlug: org.slug,
      orgName: org.name,
      counts,
      currentRoster: {
        players: currentPlayers,
        coaches: currentCoaches,
        staff: currentStaff,
        total: currentRoster.length,
      },
    };

    if (includeFrmr) {
      // Group former roster by role
      const formerPlayers = formerRoster.filter(r => r.role === 'Player');
      const formerCoaches = formerRoster.filter(r => r.role === 'Coach');
      const formerStaff = formerRoster.filter(r => !['Player', 'Coach'].includes(r.role));

      responseData.formerRoster = {
        players: formerPlayers,
        coaches: formerCoaches,
        staff: formerStaff,
        total: formerRoster.length,
      };
    }

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /orgs/:slug/history
 * Get organization tournament history
 */
export async function getOrganizationHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { slug } = req.params;
    const { limit = '20', offset = '0' } = req.query;

    if (!slug) {
      res.status(400).json({ success: false, error: 'Slug is required' });
      return;
    }

    // Check org exists
    const org = await prisma.organization.findUnique({
      where: { slug },
    });

    if (!org) {
      // Try scraping
      const scraped = await orgService.getOrg(slug);
      if (!scraped) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }
    }

    // Get tournament history from database
    const history = await prisma.orgTournamentHistory.findMany({
      where: { orgSlug: slug },
      take: parseInt(limit as string, 10),
      skip: parseInt(offset as string, 10),
      orderBy: { createdAt: 'desc' },
      include: {
        tournament: {
          select: {
            name: true,
            startDate: true,
            endDate: true,
            prizePool: true,
            region: true,
          },
        },
      },
    });

    // Also get earnings summary
    const earningsSummary = await prisma.orgTournamentHistory.aggregate({
      where: { orgSlug: slug },
      _sum: { earnings: true },
      _count: { id: true },
    });

    res.json({
      success: true,
      data: {
        orgSlug: slug,
        totalTournaments: earningsSummary._count.id,
        totalEarnings: earningsSummary._sum.earnings || 0,
        history: history.map(h => ({
          tournamentId: h.tournamentId,
          tournamentName: h.tournament.name,
          playerName: h.playerName,
          placement: h.placement,
          earnings: h.earnings,
          date: h.tournament.startDate,
          region: h.tournament.region,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /orgs/sync (admin)
 * Trigger sync of all orgs from Liquipedia
 */
export async function syncOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { full } = req.query;

    if (full === 'true') {
      // Sync with full details (logos, descriptions)
      const result = await orgService.syncAllOrgsWithDetails();
      res.json({
        success: true,
        message: `Synced ${result.synced} organizations with ${result.logos} logos`,
        ...result,
      });
    } else {
      // Quick sync (just names)
      const synced = await orgService.syncOrgsToDatabase();
      res.json({
        success: true,
        message: `Synced ${synced} organizations`,
        synced,
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * POST /orgs/:slug/sync (admin)
 * Trigger sync of specific org roster
 */
export async function syncOrganizationRoster(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { slug } = req.params;

    if (!slug) {
      res.status(400).json({ success: false, error: 'Slug is required' });
      return;
    }

    const synced = await orgService.syncRosterToDatabase(slug);

    if (synced === 0) {
      res.status(404).json({
        success: false,
        error: 'Organization not found or no roster data available',
      });
      return;
    }

    res.json({
      success: true,
      message: `Synced ${synced} roster members for ${slug}`,
      synced,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /orgs/:slug/earnings
 * Get organization earnings summary
 */
export async function getOrganizationEarnings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { slug } = req.params;

    if (!slug) {
      res.status(400).json({ success: false, error: 'Slug is required' });
      return;
    }

    // Check org exists
    const org = await prisma.organization.findUnique({
      where: { slug },
    });

    if (!org) {
      // Try to scrape org first
      const scraped = await orgService.getOrg(slug);
      if (!scraped) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }
    }

    // Get earnings summary
    const summary = await earningsService.getOrgEarningsSummary(slug);

    // Get recent results (last 10)
    const recentResults = await earningsService.getOrgEarningsHistory(slug, { limit: 10 });

    res.json({
      success: true,
      data: {
        orgSlug: slug,
        totalEarnings: summary?.totalEarnings || 0,
        tournamentCount: summary?.tournamentCount || 0,
        firstPlaceCount: summary?.firstPlaceCount || 0,
        playerCount: summary?.playerCount || 0,
        earningsByYear: summary?.earningsByYear || {},
        topEarners: summary?.earningsByPlayer || [],
        recentResults: recentResults.map(r => ({
          tournamentId: r.tournamentId,
          tournamentName: r.tournamentName,
          date: r.tournamentDate,
          placement: r.placement,
          earnings: r.earnings,
          region: r.region,
          playerIgn: r.player?.currentIgn,
        })),
        lastUpdated: summary?.lastUpdated || null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /orgs/:slug/earnings/history
 * Get detailed earnings history for organization
 */
export async function getOrganizationEarningsHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { slug } = req.params;
    const { limit = '20', offset = '0' } = req.query;

    if (!slug) {
      res.status(400).json({ success: false, error: 'Slug is required' });
      return;
    }

    // Check org exists
    const org = await prisma.organization.findUnique({
      where: { slug },
    });

    if (!org) {
      res.status(404).json({
        success: false,
        error: 'Organization not found',
      });
      return;
    }

    const earnings = await earningsService.getOrgEarningsHistory(slug, {
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    // Get total count for pagination
    const totalCount = await prisma.playerTournamentEarning.count({
      where: { orgSlugAtTime: slug },
    });

    res.json({
      success: true,
      data: {
        orgSlug: slug,
        earnings: earnings.map(e => ({
          tournamentId: e.tournamentId,
          tournamentName: e.tournamentName,
          date: e.tournamentDate,
          region: e.region,
          tier: e.tier,
          gameMode: e.gameMode,
          season: e.season,
          placement: e.placement,
          earnings: e.earnings,
          teamSize: e.teamSize,
          wikiUrl: e.wikiUrl,
          player: {
            playerId: e.playerId,
            ign: e.player?.currentIgn,
          },
          teammates: e.teammates,
        })),
        pagination: {
          total: totalCount,
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /orgs/:slug/sync-earnings (admin)
 * Trigger sync of earnings for all players in org
 */
export async function syncOrganizationEarnings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { slug } = req.params;

    if (!slug) {
      res.status(400).json({ success: false, error: 'Slug is required' });
      return;
    }

    // Get all players for this org
    const rosters = await prisma.teamRoster.findMany({
      where: { orgSlug: slug },
      include: { player: true },
    });

    if (rosters.length === 0) {
      res.status(404).json({
        success: false,
        error: 'No players found for organization',
      });
      return;
    }

    let totalSynced = 0;
    const results: { playerId: string; ign: string; synced: number }[] = [];

    // Sync earnings for each player
    for (const roster of rosters) {
      if (roster.player?.wikiUrl) {
        try {
          const synced = await earningsService.syncPlayerEarnings(roster.player.playerId);
          totalSynced += synced;
          results.push({
            playerId: roster.player.playerId,
            ign: roster.player.currentIgn,
            synced,
          });
        } catch (error: any) {
          console.error(`Failed to sync earnings for ${roster.player.currentIgn}:`, error.message);
        }
      }
    }

    // Update org earnings summary
    await earningsService.updateOrgEarningsSummary(slug);

    res.json({
      success: true,
      message: `Synced ${totalSynced} earnings records for ${slug}`,
      totalSynced,
      playerResults: results,
    });
  } catch (error) {
    next(error);
  }
}
