import type { AmmoId, MovementModuleId, SurfaceId, ToolId, WeaponId } from '../core/types';

export interface MovementModuleStrategy {
  id: MovementModuleId;
  speed: number;
  response: number;
  grip(surface: SurfaceId): number;
}

export interface AmmoStrategy {
  id: AmmoId;
  weapon: WeaponId;
  damage: number;
  speed: number;
  pierce: number;
  bounces: number;
  color?: number;
}

export interface ToolStrategy {
  id: ToolId;
  repairMultiplier: number;
  scanRadius: number;
  interactionRange: number;
}

const grip = (fallback: number, values: Partial<Record<SurfaceId, number>>) => (surface: SurfaceId): number => values[surface] ?? fallback;

export const MOVEMENT_STRATEGIES: Record<MovementModuleId, MovementModuleStrategy> = {
  'road-wheel': { id: 'road-wheel', speed: 1.1, response: 1.15, grip: grip(.72, { road: 1.18, ice: .58 }) },
  'all-terrain': { id: 'all-terrain', speed: 1, response: 1, grip: grip(1, { mud: 1.18, sand: 1.06, 'shallow-water': .88 }) },
  'snow-tread': { id: 'snow-tread', speed: .94, response: .86, grip: grip(.9, { ice: 1.35, 'deep-snow': 1.45, mud: 1.08 }) },
  'sand-float': { id: 'sand-float', speed: .97, response: .92, grip: grip(.86, { sand: 1.42, 'shallow-water': 1.08 }) },
  amphibious: { id: 'amphibious', speed: 1.02, response: 1.02, grip: grip(.94, { 'shallow-water': 1.28, 'deep-water': 1.5, road: 1 }) },
};

export const AMMO_STRATEGIES: Record<AmmoId, AmmoStrategy> = {
  'star-pulse': { id: 'star-pulse', weapon: 'pulse', damage: 1, speed: 1, pierce: 0, bounces: 0 },
  ricochet: { id: 'ricochet', weapon: 'scatter', damage: .9, speed: 1, pierce: 0, bounces: 2, color: 0xffd84a },
  frost: { id: 'frost', weapon: 'rail', damage: .72, speed: .7, pierce: 1, bounces: 0, color: 0xaef3ff },
  'repair-seed': { id: 'repair-seed', weapon: 'pulse', damage: .45, speed: .9, pierce: 0, bounces: 0, color: 0x68ff9f },
  'chain-lightning': { id: 'chain-lightning', weapon: 'arc', damage: .92, speed: 1, pierce: 0, bounces: 0, color: 0xb88cff },
  'seed-core': { id: 'seed-core', weapon: 'scatter', damage: .62, speed: .75, pierce: 0, bounces: 0, color: 0xb8ff70 },
};

export const TOOL_STRATEGIES: Record<ToolId, ToolStrategy> = {
  'repair-arm': { id: 'repair-arm', repairMultiplier: 1.5, scanRadius: 0, interactionRange: 3.5 },
  scanner: { id: 'scanner', repairMultiplier: 1, scanRadius: 10, interactionRange: 4 },
  tractor: { id: 'tractor', repairMultiplier: 1, scanRadius: 0, interactionRange: 8 },
  'bridge-projector': { id: 'bridge-projector', repairMultiplier: 1, scanRadius: 0, interactionRange: 6 },
};
