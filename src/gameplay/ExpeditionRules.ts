import { EXPEDITION_MISSIONS, SEASONS } from '../content/expedition';
import { missionGraphProgress } from './MissionGraph';
import type { ExpeditionMissionId, MovementModuleId, RouteId, SeasonId, SurfaceId, Vec2, WeatherId } from '../core/types';

export interface RouteAccessResult { open: boolean; reason: string }
export interface WeatherState { id: WeatherId; intensity: number; warning: boolean }

export function surfaceAt(pos: Vec2, season: SeasonId): SurfaceId {
  let base: SurfaceId = 'road';
  const inRiver = Math.abs(pos.x) < 2.15 && pos.z < 5.8;
  if (inRiver) base = pos.z < -2.2 ? 'deep-water' : 'shallow-water';
  else if (pos.x > 7 && pos.z < 5.5) base = 'sand';
  else if (pos.x < -5.2 || (pos.z < -5.8 && pos.x < 5)) base = 'mud';

  if (season === 'winter') {
    if (base === 'shallow-water' || base === 'deep-water') return 'ice';
    if (base === 'mud') return 'deep-snow';
  }
  if (season === 'spring' && base === 'road' && pos.z < -4) return 'mud';
  return base;
}

export function routeAccess(route: RouteId, season: SeasonId, movement: MovementModuleId): RouteAccessResult {
  if (route === 'river-route') {
    if (season === 'winter') return { open: true, reason: '湖面已经冻结，所有机体都能通过。' };
    if (movement === 'amphibious') return { open: true, reason: '浮航环已展开，水路安全。' };
    return { open: false, reason: '这条水路需要浮航模块。' };
  }
  if (season === 'winter' && movement !== 'snow-tread' && movement !== 'all-terrain') return { open: false, reason: '云岭积雪很深，建议安装雪履带或全地形轮。' };
  return { open: true, reason: movement === 'road-wheel' ? '可以通行，但湿滑坡道会降低抓地力。' : '山路装备检查通过。' };
}

export function weatherAt(elapsed: number, season: SeasonId): WeatherState {
  const id = SEASONS[season].weather;
  const cycle = elapsed % 28;
  const intensity = cycle < 8 ? .22 : cycle < 18 ? .58 : cycle < 23 ? 1 : .36;
  return { id, intensity, warning: cycle >= 16 && cycle < 23 };
}

export function missionProgress(missionId: ExpeditionMissionId, repaired: number, wave: number, score: number, bosses = 0): { value: number; target: number; complete: boolean; stage: number; label: string } {
  return missionGraphProgress(missionId, { repaired, wave, score: Math.round(score), bosses });
}

export function recommendedMovement(season: SeasonId, missionId?: ExpeditionMissionId): MovementModuleId {
  return missionId ? EXPEDITION_MISSIONS[missionId].recommended : SEASONS[season].recommendedMovement;
}
