import { AudioManager } from '../audio/AudioManager';
import { TECH_TREE, WEAPONS } from '../content/weapons';
import { CHASSIS } from '../content/chassis';
import { ACHIEVEMENTS } from '../content/achievements';
import { THEMES } from '../content/themes';
import { EXPEDITION_MISSIONS, SEASONS } from '../content/expedition';
import type { AmmoId, ChassisId, GameOptions, LoadoutPreset, MovementModuleId, PaintId, ReplayData, RunSummary, SaveData, SeasonId, TankLoadout, ThemeId, ToolId, WeaponId } from './types';
import { Simulation } from '../gameplay/Simulation';
import { InputManager } from '../input/InputManager';
import { LocalSaveRepository } from '../persistence/LocalSaveRepository';
import { ThreeRenderer } from '../render/ThreeRenderer';
import { UIController } from '../ui/UIController';
import { PerformanceGovernor } from '../platform/PerformanceGovernor';
import { PauseState } from './PauseState';
import { settleRun } from '../gameplay/RunSettlement';
import { mergeCrewControls } from '../input/CrewControls';

export class Game {
  private readonly repo = new LocalSaveRepository();
  private readonly renderer: ThreeRenderer;
  private readonly input: InputManager;
  private readonly audio = new AudioManager();
  private readonly ui: UIController;
  private save!: SaveData;
  private simulation?: Simulation;
  private lastOptions?: GameOptions;
  private lastTime = performance.now();
  private readonly pauseState = new PauseState();
  private resultHandled = false;
  private workshopActive = false;
  private workshopSeason?: SeasonId;
  private performance = new PerformanceGovernor('auto');
  private performanceHudClock = 0;
  private ambienceClock = 0;
  private simulationAccumulator = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new ThreeRenderer(canvas, THEMES['neon-city']);
    this.input = new InputManager(canvas);
    this.input.setProjection((x, y) => this.renderer.screenToGround(x, y));
    this.ui = new UIController({
      start: (options) => this.start(options),
      restart: () => this.restart(),
      home: () => this.home(),
      pause: (paused) => this.setUserPause(paused),
      buyTech: (id) => void this.buyTech(id),
      unlockWeapon: (id) => void this.unlockWeapon(id),
      unlockChassis: (id) => void this.unlockChassis(id),
      playReplay: (replay) => this.playReplay(replay),
      themePreview: (theme) => this.previewTheme(theme),
      previewWorkshop: (loadout, season) => this.previewWorkshop(loadout, season),
      closeWorkshop: () => this.closeWorkshop(),
      saveLoadout: (preset) => void this.saveLoadout(preset),
      testDrive: (options) => this.start(options),
      launchLoadout: (options) => this.start(options),
      unlockPart: (category, id, cost) => this.unlockPart(category, id, cost),
      setQuality: (quality) => void this.setQuality(quality),
      updateSettings: (settings) => void this.updateSettings(settings),
      selectCompanion: (id) => void this.selectCompanion(id),
    });
    this.input.setGamepadListener((status) => this.ui.updateGamepad(status));
    this.input.setInterfaceListener((event) => this.ui.handleGamepadInterface(event));
    this.renderer.setContextListener((state) => this.handleContextState(state));
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  async init(): Promise<void> {
    this.save = await this.repo.load();
    this.applySettings();
    this.renderer.setQuality(this.performance.setSetting(this.save.settings.quality));
    this.ui.updatePerformance(this.performance.level, this.performance.fps);
    this.ui.setSave(this.save);
    const saveStatus = this.repo.getStatus(); if (saveStatus.message) this.ui.toast(saveStatus.mode === 'memory' ? '会话安全模式' : '进度已恢复', saveStatus.message);
    this.loop(performance.now());
  }

  private start(options: GameOptions): void {
    options.companion = this.save.world.activeCompanion;
    this.audio.unlock();
    if (options.biome === 'mountain-sea-valley' && options.season) this.audio.setExpeditionAmbience(options.season, SEASONS[options.season].weather);
    else this.audio.stopAmbience();
    this.lastOptions = options;
    this.resultHandled = false;
    this.pauseState.reset();
    this.input.resetTransientState();
    this.workshopActive = false;
    this.simulationAccumulator = 0;
    if (options.biome === 'mountain-sea-valley') this.renderer.setExpeditionSeason(options.season ?? 'spring');
    else this.renderer.setTheme(options.theme);
    this.simulation = new Simulation(options, this.save.techRanks);
    if (import.meta.env.DEV && document.body.classList.contains('force-touch')) {
      this.simulation.players.forEach((player) => { player.invulnerable = 3600; });
    }
    this.renderer.setSimulation(this.simulation);
    this.bindSimulation(this.simulation);
    this.ui.showGame(options);
  }

  private restart(): void { if (this.lastOptions) this.start({ ...this.lastOptions }); }

  private home(): void {
    this.simulation = undefined;
    this.pauseState.reset();
    this.input.resetTransientState();
    this.renderer.clearSimulation();
    this.renderer.stopReplay();
    this.workshopActive = false;
    this.renderer.setTheme(this.lastOptions?.theme ?? 'neon-city');
    this.ui.showHome();
  }

  private previewTheme(theme: ThemeId): void { if (!this.simulation) this.renderer.setTheme(theme); }

  private previewWorkshop(loadout: TankLoadout, season: SeasonId): void {
    this.audio.setExpeditionAmbience(season, SEASONS[season].weather);
    if (this.workshopActive && this.workshopSeason === season) this.renderer.updateWorkshopLoadout(loadout);
    else { this.renderer.showWorkshop(loadout, season); this.workshopActive = true; this.workshopSeason = season; }
  }

  private closeWorkshop(): void {
    this.workshopActive = false;
    this.workshopSeason = undefined;
    this.audio.stopAmbience();
    this.renderer.setTheme(this.lastOptions?.theme ?? 'neon-city');
  }

  private async saveLoadout(preset: LoadoutPreset): Promise<void> {
    const index = this.save.loadoutPresets.findIndex((item) => item.id === preset.id);
    if (index >= 0) this.save.loadoutPresets[index] = preset;
    else this.save.loadoutPresets = [...this.save.loadoutPresets, preset].slice(0, 3);
    this.save.activePresetId = preset.id;
    await this.repo.save(this.save);
    this.ui.setSave(this.save);
    this.ui.toast('方案已保存', `${preset.name}已经准备好出发`);
  }

  private async unlockPart(category: 'movement' | 'ammo' | 'tool' | 'appearance', id: string, cost: number): Promise<boolean> {
    if (this.save.starShards < cost) { this.ui.toast('还差一点星屑', '完成远征与每日挑战就能继续解锁'); return false; }
    this.save.starShards -= cost;
    if (category === 'movement' && !this.save.unlockedMovementModules.includes(id as MovementModuleId)) this.save.unlockedMovementModules.push(id as MovementModuleId);
    if (category === 'ammo' && !this.save.unlockedAmmo.includes(id as AmmoId)) this.save.unlockedAmmo.push(id as AmmoId);
    if (category === 'tool' && !this.save.unlockedTools.includes(id as ToolId)) this.save.unlockedTools.push(id as ToolId);
    if (category === 'appearance' && !this.save.unlockedPaints.includes(id as PaintId)) this.save.unlockedPaints.push(id as PaintId);
    await this.repo.save(this.save); this.ui.setSave(this.save); this.ui.toast('新部件已解锁', '现在可以安装到任意装配方案');
    return true;
  }

  private async setQuality(setting: SaveData['settings']['quality']): Promise<void> {
    this.save.settings.quality = setting;
    const level = this.performance.setSetting(setting); this.renderer.setQuality(level); this.ui.updatePerformance(level, this.performance.fps);
    await this.repo.save(this.save);
    this.ui.toast('画质模式已更新', setting === 'auto' ? '会根据设备帧率自动平衡清晰度和特效' : setting === 'high' ? '高品质光影与粒子已开启' : setting === 'balanced' ? '清晰度与续航保持平衡' : '已降低分辨率与粒子数量以延长续航');
  }

  private async updateSettings(settings: Partial<SaveData['settings']>): Promise<void> {
    this.save.settings = { ...this.save.settings, ...settings };
    this.applySettings(); await this.repo.save(this.save); this.ui.setSave(this.save);
    const status = this.repo.getStatus(); this.ui.toast('家庭设置已保存', status.message ?? '新的舒适度设置已经生效');
  }

  private applySettings(): void {
    const settings = this.save.settings;
    const systemRequestsReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const comfortSettings = { reduceFlashes: settings.reduceFlashes || systemRequestsReducedMotion };
    this.audio.setPreferences(settings.music, settings.sfx, settings.masterVolume);
    this.input.setPreferences(settings); this.renderer.setAccessibility(comfortSettings);
    document.body.classList.toggle('is-left-handed', settings.leftHanded);
    document.body.classList.toggle('is-large-text', settings.largeText);
    document.body.classList.toggle('reduce-flashes', comfortSettings.reduceFlashes);
    document.body.dataset.colorMode = settings.colorMode;
  }

  private setUserPause(paused: boolean): void {
    if (paused) this.pauseState.set('manual', true); else this.pauseState.resumeByUser();
    if (this.pauseState.paused) {
      const restoring = this.pauseState.has('webgl');
      this.ui.setSystemPause(true, restoring ? '画面正在安全恢复' : '星核引擎待机中', restoring ? '画面恢复完成后才能继续，当前进度不会丢失。' : '活动一下手指，准备好后继续。');
    } else this.ui.setSystemPause(false);
  }

  private handleContextState(state: 'lost' | 'restored'): void {
    if (state === 'lost') {
      this.pauseState.set('webgl', true); this.input.resetTransientState(); this.audio.stopAmbience(.08);
      if (this.simulation && !this.simulation.over) this.ui.setSystemPause(true, '画面正在安全恢复', '请不要关闭页面，星核任务和成长进度都不会丢失。');
    } else {
      this.lastTime = performance.now(); this.simulationAccumulator = 0; this.pauseState.set('webgl', false);
      if (this.simulation && !this.simulation.over) {
        if (this.pauseState.paused) this.ui.setSystemPause(true, '任务仍处于安全暂停', '返回页面后请点击继续，不会因为恢复画面而自动进入战斗。');
        else this.ui.setSystemPause(false);
        this.ui.toast('画面恢复完成', this.pauseState.paused ? '仍保持暂停，准备好后再继续' : '任务已从安全暂停点继续');
      }
    }
  }

  private onVisibilityChange = (): void => {
    this.lastTime = performance.now(); this.simulationAccumulator = 0;
    if (document.hidden && this.simulation && !this.simulation.over) {
      this.pauseState.set('hidden', true); this.input.resetTransientState();
      this.ui.setSystemPause(true, '任务已自动暂停', '回到页面后点击继续，不会因为切换应用受到伤害。');
    }
  };

  private playReplay(replay: ReplayData): void {
    this.simulation = undefined;
    this.audio.stopAmbience();
    this.renderer.setTheme(replay.options.theme);
    this.renderer.startReplay(replay.frames);
    this.ui.showReplay();
  }

  private bindSimulation(sim: Simulation): void {
    sim.on('shot', ({ player, projectile }) => {
      this.renderer.muzzle(player.pos, projectile.color);
      this.audio.shot(player.weapon === 'rail' ? .65 : 1);
      this.input.rumble(player.slot, .18, 38);
    });
    sim.on('hit', ({ pos, color, heavy }) => { this.renderer.burst(pos, color, heavy); this.audio.hit(heavy); });
    sim.on('repaired', ({ enemy, pos, score }) => {
      this.renderer.burst(pos, enemyColor(enemy.kind), enemy.kind === 'boss');
      const point = this.renderer.worldToScreen(pos, 1.4);
      if (point.visible) this.ui.floatText(point.x, point.y, `+${score}`, enemy.kind === 'boss');
    });
    sim.on('damage', ({ pos, value, critical }) => {
      const point = this.renderer.worldToScreen(pos, 1.8);
      if (point.visible) this.ui.floatText(point.x, point.y, value.toString(), critical);
    });
    sim.on('pickup', ({ pos, kind }) => {
      this.renderer.ability(pos, 0xffd84a);
      this.audio.pickup();
      this.ui.toast('强化芯片', pickupName(kind));
    });
    sim.on('playerHit', ({ player }) => { this.renderer.burst(player.pos, 0xff5d75, false); this.audio.hit(false); this.input.rumble(player.slot, .58, 120); });
    sim.on('ability', ({ player, ability, pos }) => { this.renderer.ability(pos, abilityColor(ability)); this.audio.ability(); this.input.rumble(player.slot, ability === 'storm' ? .8 : .38, ability === 'storm' ? 180 : 80); });
    sim.on('wave', ({ wave, boss }) => {
      this.audio.wave();
      this.ui.toast(
        boss ? '区域霸主抵达' : `第 ${wave} 波`,
        boss ? '观察攻击节奏，和伙伴一起行动' : wave % 3 === 0 ? '新的伙伴机类型加入了挑战' : '保持移动，连击会提高得分',
      );
      if (boss && sim.options.companion === 'snowball') this.ui.toast('雪球发现弱点', '先用扫描标记霸主，再攻击会造成更多伤害');
    });
    sim.on('event', ({ message }) => this.ui.toast('关卡事件', message));
    sim.on('mission', ({ missionId }) => {
      const mission = EXPEDITION_MISSIONS[missionId];
      this.ui.toast('远征目标达成', `${mission.name}完成！任务结束后可领取 ${mission.reward} 星屑`);
      this.renderer.ability(sim.players[0]?.pos ?? { x: 0, z: 0 }, SEASONS[mission.season].accent);
    });
    sim.on('message', ({ title, body }) => this.ui.toast(title, body));
    sim.on('gameOver', () => void this.finishRun(sim));
  }

  private async finishRun(sim: Simulation): Promise<void> {
    if (this.resultHandled) return;
    this.resultHandled = true;
    const stars = Math.max(3, Math.ceil(sim.score / 650) + sim.wave * 2 + Math.min(20, sim.repaired));
    const title = sim.wave >= 10 ? '星际领航员' : sim.wave >= 5 ? '小小守护者' : sim.repaired >= 15 ? '修复工程师' : '勇敢探索家';
    const summary: RunSummary = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      score: Math.round(sim.score),
      wave: sim.wave,
      mode: sim.options.mode,
      theme: sim.options.theme,
      duration: sim.elapsed,
      repaired: sim.repaired,
      stars,
      title,
      season: sim.options.season,
      missionId: sim.options.missionId,
      missionComplete: sim.missionComplete,
      dailyKey: sim.dailyRule?.id,
      dailyComplete: sim.dailyComplete,
      dailyReward: sim.dailyRule?.reward,
    };
    const replay: ReplayData = {
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), options: sim.options,
      summary, frames: sim.replayFrames,
    };
    const settled = settleRun(this.save, { summary, replay, route: sim.options.route, encounteredEnemies: sim.encounteredEnemies, coop: sim.options.coop });
    await this.repo.save(settled.save);
    this.save = settled.save;
    if (settled.unlockedAchievements.length) {
      const first = ACHIEVEMENTS.find((achievement) => achievement.id === settled.unlockedAchievements[0]);
      if (first) this.ui.toast('新成就', `${first.name} · 奖励 20 星屑`);
    }
    this.ui.setSave(this.save);
    this.ui.showResult(summary);
  }

  private async buyTech(id: string): Promise<void> {
    const node = TECH_TREE.find((item) => item.id === id);
    if (!node) return;
    const rank = this.save.techRanks[id] ?? 0;
    const cost = node.costs[rank];
    if (cost === undefined || this.save.starShards < cost) return;
    if (node.requires && (this.save.techRanks[node.requires] ?? 0) === 0) return;
    this.save.starShards -= cost;
    this.save.techRanks[id] = rank + 1;
    await this.repo.save(this.save);
    this.ui.setSave(this.save);
    this.ui.toast('科技升级完成', `${node.name}提升到 ${rank + 1} 级`);
  }

  private async selectCompanion(id: SaveData['world']['activeCompanion']): Promise<void> {
    if (!this.save.world.unlockedCompanions.includes(id)) return;
    this.save.world.activeCompanion = id;
    await this.repo.save(this.save); this.ui.setSave(this.save);
    this.ui.toast('伙伴已加入', '新的远征伙伴会在下一次任务中陪你出发');
  }

  private async unlockWeapon(id: WeaponId): Promise<void> {
    const weapon = WEAPONS[id];
    if (this.save.unlockedWeapons.includes(id) || this.save.starShards < weapon.unlockCost) return;
    this.save.starShards -= weapon.unlockCost;
    this.save.unlockedWeapons.push(id);
    await this.repo.save(this.save);
    this.ui.setSave(this.save);
    this.ui.toast('新武器已解锁', weapon.name);
  }

  private async unlockChassis(id: ChassisId): Promise<void> {
    const chassis = CHASSIS[id];
    if (this.save.unlockedChassis.includes(id) || this.save.starShards < chassis.unlockCost) return;
    this.save.starShards -= chassis.unlockCost;
    this.save.unlockedChassis.push(id);
    await this.repo.save(this.save);
    this.ui.setSave(this.save);
    this.ui.toast('新机体已解锁', chassis.name);
  }

  private loop = (time: number): void => {
    const rawDt = Math.max(0, (time - this.lastTime) / 1000);
    const dt = Math.min(.05, rawDt);
    this.lastTime = time;
    this.input.pollInterface();
    const qualityChange = this.performance.sample(rawDt || 1 / 60);
    if (qualityChange) this.renderer.setQuality(qualityChange);
    this.performanceHudClock -= dt;
    if (this.performanceHudClock <= 0) { this.performanceHudClock = .75; this.ui.updatePerformance(this.performance.level, this.performance.fps); }
    const sim = this.simulation;
    if (sim && !this.pauseState.paused && !sim.over) {
      this.ambienceClock -= dt;
      if (this.ambienceClock <= 0) { this.ambienceClock = .2; this.audio.updateAmbience(sim.weather.intensity, sim.weather.warning || sim.eventKind === 'lightning'); }
      const p1 = sim.players[0];
      if (p1) this.input.setPlayerWorld(p1.pos);
      this.simulationAccumulator = Math.min(.1, this.simulationAccumulator + dt);
      const fixedStep = 1 / 60;
      while (this.simulationAccumulator >= fixedStep) {
        const p1Controls = this.input.frame(1);
        const p2Controls = this.input.frame(2);
        sim.update(fixedStep, sim.options.crewMode ? [mergeCrewControls(p1Controls, p2Controls)] : [p1Controls, p2Controls]);
        this.simulationAccumulator -= fixedStep;
      }
      this.ui.update(sim);
      if (sim.options.testDrive && sim.elapsed >= 20) {
        const movement = sim.options.loadout?.movement;
        this.simulation = undefined; this.renderer.clearSimulation(); this.workshopActive = false;
        this.workshopSeason = undefined;
        this.ui.returnToWorkshop(this.save, movement === 'amphibious' ? '浮航环稳定展开，水陆切换测试通过！' : '转向、制动与抓地测试全部通过！');
      }
      if (sim.options.mode === 'adventure' && sim.elapsed >= 480 && !this.resultHandled) {
        sim.over = true;
        void this.finishRun(sim);
      }
      if (sim.options.mode === 'adventure' && sim.missionComplete && sim.elapsed - sim.missionCompletedAt >= 1.8 && !this.resultHandled) {
        sim.over = true;
        void this.finishRun(sim);
      }
    }
    this.renderer.render(dt);
    requestAnimationFrame(this.loop);
  };
}

function abilityColor(ability: string): number {
  return ability === 'shield' ? 0x5aefff : ability === 'repair' ? 0x68ff9f : ability === 'dash' ? 0xffd84a : 0xb88cff;
}

function pickupName(kind: string): string {
  return kind === 'shield' ? '能量护盾已展开' : kind === 'rapid' ? '射速暂时提升' : kind === 'multi' ? '多重能量弹已启动' : kind === 'power' ? '武器威力暂时提升' : '发现额外星屑';
}

function enemyColor(kind: string): number {
  const colors: Record<string, number> = { scout: 0xff5f8f, charger: 0xffb13b, gunner: 0xa975ff, bulwark: 0x4ea9ff, splitter: 0xf26cff, medic: 0x61f5a1, sniper: 0xffe16a, stalker: 0x56f0ff, summoner: 0xff78d8, reflector: 0x8ffaff, warden: 0xe497ff, boss: 0xff3f70 };
  return colors[kind] ?? 0xffffff;
}
