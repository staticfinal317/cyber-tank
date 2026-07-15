import type { ControlFrame } from '../gameplay/Simulation';

/** Combines a driver's movement with a gunner's aim/actions for one shared tank. */
export function mergeCrewControls(driver: ControlFrame, gunner: ControlFrame): ControlFrame {
  return {
    move: driver.move,
    aim: gunner.aimActive ? gunner.aim : driver.aim,
    firing: driver.firing || gunner.firing,
    abilities: new Set([...driver.abilities, ...gunner.abilities]),
    abilityTargets: new Map([...(driver.abilityTargets ?? new Map()), ...(gunner.abilityTargets ?? new Map())]),
    switchAmmo: driver.switchAmmo || gunner.switchAmmo,
    ping: driver.ping || gunner.ping,
    aimActive: driver.aimActive || gunner.aimActive,
  };
}
