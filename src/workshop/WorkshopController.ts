import { AMMO, BIOMES, cloneLoadout, EXPEDITION_MISSIONS, MOVEMENT_MODULES, PAINTS, SEASONS, TOOLS } from '../content/expedition';
import { recommendedMovement, routeAccess } from '../gameplay/ExpeditionRules';
import type { AmmoId, ExpeditionMissionId, LoadoutPreset, MovementModuleId, PaintId, RouteId, SaveData, SeasonId, TankLoadout, ToolId } from '../core/types';

type Category = 'movement' | 'ammo' | 'tool' | 'appearance';

export interface WorkshopActions {
  preview: (loadout: TankLoadout, season: SeasonId) => void;
  save: (preset: LoadoutPreset) => void;
  testDrive: (loadout: TankLoadout, season: SeasonId, route: RouteId, mission: ExpeditionMissionId) => void;
  launch: (loadout: TankLoadout, season: SeasonId, route: RouteId, mission: ExpeditionMissionId) => void;
  close: () => void;
  unlock: (category: Category, id: string, cost: number) => Promise<boolean>;
}

function node<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing workshop element #${id}`);
  return value as T;
}

export class WorkshopController {
  private save?: SaveData;
  private category: Category = 'movement';
  private presetId = 'preset-1';
  private loadout?: TankLoadout;
  private dirty = false;
  private season: SeasonId = 'spring';
  private route: RouteId = 'river-route';
  private mission: ExpeditionMissionId = 'spring-river';

  constructor(private readonly actions: WorkshopActions) {
    document.querySelectorAll<HTMLButtonElement>('[data-workshop-category]').forEach((button) => {
      button.addEventListener('click', () => {
        this.category = button.dataset.workshopCategory as Category;
        document.querySelectorAll('[data-workshop-category]').forEach((item) => item.classList.toggle('is-selected', item === button));
        this.renderItems();
      });
    });
    node('workshop-close').addEventListener('click', actions.close);
    node('workshop-test').addEventListener('click', () => { if (this.loadout) actions.testDrive(cloneLoadout(this.loadout), this.season, this.route, this.mission); });
    node('workshop-launch').addEventListener('click', () => { if (this.loadout && routeAccess(this.route, this.season, this.loadout.movement).open) actions.launch(cloneLoadout(this.loadout), this.season, this.route, this.mission); });
    node('workshop-save').addEventListener('click', () => this.savePreset());
    node('workshop-copy').addEventListener('click', () => this.copyPreset());
    node('ammo-slot-0').addEventListener('click', () => this.setAmmoSlot(0));
    node('ammo-slot-1').addEventListener('click', () => this.setAmmoSlot(1));
    document.querySelectorAll<HTMLButtonElement>('[data-season]').forEach((button) => button.addEventListener('click', () => {
      this.season = button.dataset.season as SeasonId; this.mission = SEASONS[this.season].missions[0]!;
      document.querySelectorAll('[data-season]').forEach((item) => item.classList.toggle('is-selected', item === button));
      this.renderAll(); if (this.loadout) this.actions.preview(cloneLoadout(this.loadout), this.season);
    }));
    document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((button) => button.addEventListener('click', () => {
      this.route = button.dataset.route as RouteId;
      document.querySelectorAll('[data-route]').forEach((item) => item.classList.toggle('is-selected', item === button));
      this.renderRouteAccess();
    }));
  }

  setSave(save: SaveData): void {
    this.save = save;
    if (!save.loadoutPresets.some((preset) => preset.id === this.presetId)) this.presetId = save.activePresetId;
    if (!this.loadout) this.loadout = cloneLoadout(this.currentPreset().loadout);
  }

  open(save: SaveData): void {
    this.save = save; this.presetId = save.activePresetId;
    this.loadout = cloneLoadout(this.currentPreset().loadout); this.dirty = false;
    node('workshop').classList.remove('is-hidden');
    this.renderAll(); this.actions.preview(cloneLoadout(this.loadout), this.season);
  }

  close(): void { node('workshop').classList.add('is-hidden'); }

  private currentPreset(): LoadoutPreset {
    const fallback = this.save?.loadoutPresets[0];
    const preset = this.save?.loadoutPresets.find((item) => item.id === this.presetId) ?? fallback;
    if (!preset) throw new Error('Workshop requires a loadout preset');
    return preset;
  }

  private renderAll(): void {
    if (!this.loadout || !this.save) return;
    const season = SEASONS[this.season];
    node('workshop-forecast').textContent = season.forecast;
    node('workshop-route-hint').textContent = season.routeHint;
    node('workshop-destination').textContent = `山海谷 · ${season.name}`;
    node('workshop-preset-name').textContent = this.currentPreset().name;
    this.renderPresets(); this.renderMissions(); this.renderItems(); this.renderDetails(); this.renderAmmoSlots(); this.renderRouteAccess();
  }

  private renderPresets(): void {
    if (!this.save) return;
    const root = node('workshop-presets'); root.innerHTML = '';
    this.save.loadoutPresets.forEach((preset, index) => {
      const button = document.createElement('button');
      button.className = `preset-tab${preset.id === this.presetId ? ' is-selected' : ''}`;
      button.innerHTML = `<span>0${index + 1}</span><strong>${preset.name}</strong>`;
      button.addEventListener('click', () => {
        this.presetId = preset.id; this.loadout = cloneLoadout(preset.loadout); this.dirty = false;
        this.renderAll(); this.actions.preview(cloneLoadout(this.loadout), this.season);
      });
      root.append(button);
    });
  }

  private renderItems(): void {
    if (!this.loadout || !this.save) return;
    const root = node('workshop-items'); root.innerHTML = '';
    const add = (id: string, name: string, description: string, color: number, selected: boolean, unlocked: boolean, cost: number, apply: () => void) => {
      const button = document.createElement('button'); button.className = `module-card${selected ? ' is-selected' : ''}${unlocked ? '' : ' is-locked'}`;
      button.style.setProperty('--module-color', `#${color.toString(16).padStart(6, '0')}`);
      button.draggable = unlocked; button.dataset.moduleId = id;
      const recommended = this.category === 'movement' && id === recommendedMovement(this.season, this.mission);
      button.innerHTML = `<i class="module-visual module-visual--${id}" aria-hidden="true"><b></b><b></b><b></b></i><span>${name}</span><small>${unlocked ? description : `${cost} 星屑解锁`}</small>${selected ? '<em>已安装</em>' : recommended ? '<em>任务推荐</em>' : ''}`;
      const choose = async () => {
        if (!unlocked) { if (await this.actions.unlock(this.category, id, cost)) { this.renderItems(); } return; }
        apply(); this.dirty = true; this.renderItems(); this.renderDetails(); this.renderAmmoSlots(); this.renderRouteAccess(); this.actions.preview(cloneLoadout(this.loadout!), this.season);
      };
      button.addEventListener('click', choose);
      button.addEventListener('dragstart', (event) => event.dataTransfer?.setData('text/plain', id));
      root.append(button);
    };

    if (this.category === 'movement') (Object.keys(MOVEMENT_MODULES) as MovementModuleId[]).forEach((id) => {
      const item = MOVEMENT_MODULES[id]; add(id, item.shortName, item.description, item.color, this.loadout!.movement === id, this.save!.unlockedMovementModules.includes(id), item.unlockCost, () => { this.loadout!.movement = id; });
    });
    if (this.category === 'ammo') (Object.keys(AMMO) as AmmoId[]).forEach((id) => {
      const item = AMMO[id]; add(id, item.name, item.description, item.color, this.loadout!.ammoSlots[this.loadout!.activeAmmoIndex] === id, this.save!.unlockedAmmo.includes(id), item.unlockCost, () => { this.loadout!.ammoSlots[this.loadout!.activeAmmoIndex] = id; });
    });
    if (this.category === 'tool') (Object.keys(TOOLS) as ToolId[]).forEach((id) => {
      const item = TOOLS[id]; add(id, item.name, item.description, item.color, this.loadout!.tool === id, this.save!.unlockedTools.includes(id), item.unlockCost, () => { this.loadout!.tool = id; });
    });
    if (this.category === 'appearance') (Object.keys(PAINTS) as PaintId[]).forEach((id) => {
      const item = PAINTS[id]; add(id, item.name, item.description, item.color, this.loadout!.paint === id, this.save!.unlockedPaints.includes(id), item.unlockCost, () => { this.loadout!.paint = id; });
    });
    node('workshop-category-title').textContent = this.category === 'movement' ? '选择行走模块' : this.category === 'ammo' ? '配置双炮弹槽' : this.category === 'tool' ? '选择探索工具' : '选择机体喷漆';
  }

  private renderDetails(): void {
    if (!this.loadout) return;
    const item = MOVEMENT_MODULES[this.loadout.movement];
    node('workshop-module-name').textContent = item.name;
    node('workshop-module-description').textContent = item.description;
    (['mountain', 'water', 'road'] as const).forEach((key) => {
      const bar = node(`rating-${key}`); bar.style.setProperty('--rating', `${item.ratings[key] * 20}%`);
      bar.querySelector('b')!.textContent = `${item.ratings[key]} / 5`;
    });
    node('workshop-save').classList.toggle('has-changes', this.dirty);
  }

  private renderAmmoSlots(): void {
    if (!this.loadout) return;
    this.loadout.ammoSlots.forEach((id, index) => {
      const button = node<HTMLButtonElement>(`ammo-slot-${index}`);
      button.classList.toggle('is-selected', index === this.loadout!.activeAmmoIndex);
      button.innerHTML = `<span>${index === 0 ? '主炮' : '副炮'}</span><strong>${AMMO[id].name}</strong>`;
    });
  }

  private renderMissions(): void {
    const root = node('mission-selector'); root.innerHTML = '';
    SEASONS[this.season].missions.forEach((id) => {
      const mission = EXPEDITION_MISSIONS[id]; const button = document.createElement('button');
      button.className = id === this.mission ? 'is-selected' : '';
      button.innerHTML = `<span>${mission.name}</span><small>${mission.description}</small>`;
      button.addEventListener('click', () => { this.mission = id; this.renderMissions(); this.renderItems(); });
      root.append(button);
    });
  }

  private renderRouteAccess(): void {
    if (!this.loadout) return;
    const access = routeAccess(this.route, this.season, this.loadout.movement);
    const status = node('route-status'); status.textContent = access.reason; status.classList.toggle('is-locked', !access.open);
    const launch = node<HTMLButtonElement>('workshop-launch'); launch.disabled = !access.open; launch.classList.toggle('is-locked', !access.open);
    const routeDef = BIOMES['mountain-sea-valley'].routes.find((item) => item.id === this.route);
    launch.title = access.open ? `${routeDef?.name ?? '路线'}装备检查通过` : access.reason;
  }

  private setAmmoSlot(index: 0 | 1): void {
    if (!this.loadout) return; this.loadout.activeAmmoIndex = index; this.renderAmmoSlots();
    if (this.category === 'ammo') this.renderItems();
  }

  private savePreset(): void {
    if (!this.loadout) return;
    const preset: LoadoutPreset = { ...this.currentPreset(), loadout: cloneLoadout(this.loadout), updatedAt: new Date().toISOString() };
    this.actions.save(preset); this.dirty = false; this.renderDetails();
  }

  private copyPreset(): void {
    if (!this.save || !this.loadout) return;
    const currentIndex = this.save.loadoutPresets.findIndex((preset) => preset.id === this.presetId);
    const target = this.save.loadoutPresets[(currentIndex + 1) % this.save.loadoutPresets.length]; if (!target) return;
    const copied: LoadoutPreset = { ...target, name: `${this.currentPreset().name}·副本`.slice(0, 16), loadout: cloneLoadout(this.loadout), updatedAt: new Date().toISOString() };
    this.actions.save(copied); this.presetId = copied.id; this.dirty = false;
  }
}
