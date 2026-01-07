import { Request, Response, NextFunction } from 'express';
import { orgService } from '../services/scraper/org.service.js';

/**
 * GET /transfers
 * Get recent transfers
 */
export async function getTransfers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { limit = '20', offset = '0', org } = req.query;

    const transfers = await orgService.getRecentTransfers({
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
      orgSlug: org as string | undefined,
    });

    res.json({
      success: true,
      data: {
        transfers: transfers.map(t => ({
          id: t.id,
          playerName: t.playerName,
          playerId: t.playerId,
          playerIgn: t.player?.currentIgn,
          fromOrg: t.fromOrg ? {
            slug: t.fromOrg.slug,
            name: t.fromOrg.name,
          } : null,
          toOrg: t.toOrg ? {
            slug: t.toOrg.slug,
            name: t.toOrg.name,
          } : null,
          transferDate: t.transferDate,
          transferType: t.transferType,
          details: t.details,
        })),
        pagination: {
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
 * POST /transfers/sync
 * Sync transfers from Liquipedia
 * Query params:
 *   - limit: max transfers to sync (default 100)
 *   - year: year to sync (default current year)
 *   - month: month name to sync (default current month), e.g. "January", "December"
 */
export async function syncTransfers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { limit = '100', year, month } = req.query;

    const synced = await orgService.syncTransfers({
      limit: parseInt(limit as string, 10),
      year: year ? parseInt(year as string, 10) : undefined,
      month: month as string | undefined,
    });

    res.json({
      success: true,
      message: `Synced ${synced} transfers`,
      synced,
    });
  } catch (error) {
    next(error);
  }
}
