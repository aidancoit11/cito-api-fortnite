import { Request, Response } from 'express';
import { lolStaticService } from '../services/lol/lol-static.service.js';

export async function getChampions(req: Request, res: Response): Promise<void> {
  try {
    const champions = await lolStaticService.getChampions(req.query);
    res.json(champions);
  } catch (error) {
    console.error('Error fetching champions:', error);
    res.status(500).json({ error: 'Failed to fetch champions' });
  }
}

export async function getChampionById(req: Request, res: Response): Promise<void> {
  try {
    const { championId } = req.params;
    const champion = await lolStaticService.getChampionById(championId as string);
    if (!champion) {
      res.status(404).json({ error: 'Champion not found' });
      return;
    }
    res.json(champion);
  } catch (error) {
    console.error('Error fetching champion by ID:', error);
    res.status(500).json({ error: 'Failed to fetch champion' });
  }
}

export async function getItems(req: Request, res: Response): Promise<void> {
  try {
    const items = await lolStaticService.getItems(req.query);
    res.json(items);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
}

export async function getItemById(req: Request, res: Response): Promise<void> {
  try {
    const { itemId } = req.params;
    const item = await lolStaticService.getItemById(parseInt(itemId as string, 10));
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    console.error('Error fetching item by ID:', error);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
}

export async function getPatches(req: Request, res: Response): Promise<void> {
  try {
    const patches = await lolStaticService.getPatches(req.query);
    res.json(patches);
  } catch (error) {
    console.error('Error fetching patches:', error);
    res.status(500).json({ error: 'Failed to fetch patches' });
  }
}

export async function getCurrentPatch(_req: Request, res: Response): Promise<void> {
  try {
    const patch = await lolStaticService.getCurrentPatch();
    res.json(patch);
  } catch (error) {
    console.error('Error fetching current patch:', error);
    res.status(500).json({ error: 'Failed to fetch current patch' });
  }
}

export async function getRegions(_req: Request, res: Response): Promise<void> {
  try {
    const regions = await lolStaticService.getRegions();
    res.json(regions);
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
}

export async function getRoles(_req: Request, res: Response): Promise<void> {
  try {
    const roles = await lolStaticService.getRoles();
    res.json(roles);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
}
