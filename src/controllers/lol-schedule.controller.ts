import { Request, Response } from 'express';
import { lolScheduleService, ScheduleFilters } from '../services/lol/lol-schedule.service.js';

export async function getFullSchedule(req: Request, res: Response): Promise<void> {
  try {
    const filters: ScheduleFilters = {
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
      leagueId: req.query.leagueId as string | undefined,
      leagueSlug: req.query.leagueSlug as string | undefined,
      teamSlug: req.query.teamSlug as string | undefined,
      live: req.query.live === 'true',
      upcoming: req.query.upcoming === 'true',
      completed: req.query.completed === 'true',
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };
    const schedule = await lolScheduleService.getFullSchedule(filters);
    res.json(schedule);
  } catch (error) {
    console.error('Error fetching full schedule:', error);
    res.status(500).json({ error: 'Failed to fetch full schedule' });
  }
}

export async function getTodaysMatches(req: Request, res: Response): Promise<void> {
  try {
    const timezone = (req.query.timezone as string) || 'UTC';
    const leagueSlug = req.query.leagueSlug as string | undefined;
    const matches = await lolScheduleService.getTodaysMatches(timezone, leagueSlug);
    res.json(matches);
  } catch (error) {
    console.error('Error fetching today\'s matches:', error);
    res.status(500).json({ error: 'Failed to fetch today\'s matches' });
  }
}

export async function getThisWeeksMatches(req: Request, res: Response): Promise<void> {
  try {
    const leagueSlug = req.query.leagueSlug as string | undefined;
    const matches = await lolScheduleService.getThisWeeksMatches(leagueSlug);
    res.json(matches);
  } catch (error) {
    console.error('Error fetching this week\'s matches:', error);
    res.status(500).json({ error: 'Failed to fetch this week\'s matches' });
  }
}

export async function getUpcomingMatches(req: Request, res: Response): Promise<void> {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 24;
    const leagueSlug = req.query.leagueSlug as string | undefined;
    const matches = await lolScheduleService.getUpcomingMatches(hours, leagueSlug);
    res.json(matches);
  } catch (error) {
    console.error('Error fetching upcoming matches:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming matches' });
  }
}
