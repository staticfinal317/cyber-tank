import type { ReplayData, RunSummary, SaveData } from '../core/types';
import { createDefaultSave, type SaveRepository } from './SaveRepository';

const KEY = 'cyber-tank.save.v2';

function normalize(input: Partial<SaveData> | null): SaveData {
  const defaults = createDefaultSave();
  if (!input) return defaults;
  return {
    ...defaults,
    ...input,
    version: 2,
    settings: { ...defaults.settings, ...input.settings },
    leaderboard: Array.isArray(input.leaderboard) ? input.leaderboard.slice(0, 20) : [],
    replays: Array.isArray(input.replays) ? input.replays.slice(0, 5) : [],
  };
}

export class LocalSaveRepository implements SaveRepository {
  async load(): Promise<SaveData> {
    try {
      return normalize(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SaveData> | null);
    } catch {
      return createDefaultSave();
    }
  }

  async save(data: SaveData): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(normalize(data)));
  }

  async addRun(summary: RunSummary, replay?: ReplayData): Promise<SaveData> {
    const data = await this.load();
    data.highScore = Math.max(data.highScore, summary.score);
    data.starShards += summary.stars;
    data.totalRepaired += summary.repaired;
    data.leaderboard = [...data.leaderboard, summary]
      .sort((a, b) => b.score - a.score || b.wave - a.wave)
      .slice(0, 20);
    if (replay) data.replays = [replay, ...data.replays].slice(0, 5);
    await this.save(data);
    return data;
  }
}
