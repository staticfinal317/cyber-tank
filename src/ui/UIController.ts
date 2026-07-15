import { TECH_TREE, WEAPONS } from '../content/weapons';
import { CHASSIS } from '../content/chassis';
import { THEME_ORDER, THEMES } from '../content/themes';
import { EXPEDITION_MISSIONS, SEASONS, SURFACES, WEATHER } from '../content/expedition';
import type { ChassisId, ExpeditionMissionId, GameOptions, LoadoutPreset, ReplayData, RouteId, RunSummary, SaveData, SeasonId, TankLoadout, ThemeId, WeaponId } from '../core/types';
import { seedFromDate } from '../core/RNG';
import type { Simulation } from '../gameplay/Simulation';
import { WORLD_EVENTS } from '../gameplay/WorldEvents';
import { ENEMIES } from '../content/enemies';
import { COMPANIONS, VALLEY_LEVEL_XP } from '../gameplay/WorldProgression';
import { WorkshopController } from '../workshop/WorkshopController';
import type { GamepadStatus } from '../input/InputManager';
import type { QualitySetting, RenderQuality } from '../platform/PerformanceGovernor';

type PanelName = 'tech' | 'armory' | 'leaderboard' | 'replays' | 'settings' | 'home';

export interface UIActions {
  start: (options: GameOptions) => void;
  restart: () => void;
  home: () => void;
  pause: (paused: boolean) => void;
  buyTech: (id: string) => void;
  unlockWeapon: (id: WeaponId) => void;
  unlockChassis: (id: ChassisId) => void;
  playReplay: (replay: ReplayData) => void;
  themePreview: (theme: ThemeId) => void;
  previewWorkshop: (loadout: TankLoadout, season: SeasonId) => void;
  closeWorkshop: () => void;
  saveLoadout: (preset: LoadoutPreset) => void;
  testDrive: (options: GameOptions) => void;
  launchLoadout: (options: GameOptions) => void;
  unlockPart: (category: 'movement' | 'ammo' | 'tool' | 'appearance', id: string, cost: number) => Promise<boolean>;
  setQuality: (quality: QualitySetting) => void;
  updateSettings: (settings: Partial<SaveData['settings']>) => void;
  selectCompanion: (id: SaveData['world']['activeCompanion']) => void;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element #${id}`);
  return node as T;
}

const CHASSIS_NAMES = { spark: '星火号', guardian: '守护者', comet: '彗星号' } as const;
const DAILY_NAMES = ['极光快递', '水晶回声', '云端守护', '峡谷寻宝', '霓虹接力'];

export class UIController {
  private save!: SaveData;
  private options: GameOptions = { mode: 'adventure', theme: 'neon-city', assist: 'standard', coop: false, weapon: 'pulse', chassis: 'spark' };
  private panel?: PanelName;
  private paused = false;
  private readonly workshop: WorkshopController;

  constructor(private readonly actions: UIActions) {
    this.renderThemes();
    this.workshop = new WorkshopController({
      preview: (loadout, season) => actions.previewWorkshop(loadout, season),
      save: (preset) => actions.saveLoadout(preset),
      testDrive: (loadout, season, route, mission) => actions.testDrive(this.optionsWithLoadout(loadout, true, season, route, mission)),
      launch: (loadout, season, route, mission) => actions.launchLoadout(this.optionsWithLoadout(loadout, false, season, route, mission)),
      close: () => this.closeWorkshop(),
      unlock: (category, id, cost) => actions.unlockPart(category, id, cost),
    });
    this.bind();
    this.updateInputHint();
  }

  setSave(save: SaveData): void {
    this.save = save;
    this.workshop.setSave(save);
    byId('shard-count').textContent = save.starShards.toLocaleString('zh-CN');
    if (!save.unlockedWeapons.includes(this.options.weapon)) this.options.weapon = save.unlockedWeapons[0] ?? 'pulse';
    if (!save.unlockedChassis.includes(this.options.chassis)) this.options.chassis = save.unlockedChassis[0] ?? 'spark';
    byId('weapon-label').textContent = WEAPONS[this.options.weapon].name;
    byId('chassis-label').textContent = CHASSIS_NAMES[this.options.chassis];
    byId<HTMLSelectElement>('quality-select').value = save.settings.quality;
    if (this.panel) this.renderPanel(this.panel);
  }

  showGame(options?: GameOptions): void {
    this.resetStageScroll();
    this.workshop.close();
    byId('main-menu').classList.add('is-hidden');
    byId('game-over').classList.add('is-hidden');
    byId('side-panel').classList.add('is-hidden');
    byId('hud').classList.remove('is-hidden');
    byId('pause-button').classList.remove('is-hidden');
    if (document.body.classList.contains('force-touch') || matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) byId('touch-controls').classList.remove('is-hidden');
    byId('p2-status').classList.toggle('is-hidden', !this.options.coop);
    const mission = options?.missionId ? EXPEDITION_MISSIONS[options.missionId] : undefined;
    byId('mission-label').textContent = options?.testDrive ? `20 秒${SEASONS[options.season ?? 'spring'].name}试驾` : mission?.name ?? '守护星核基地';
    byId('event-label').textContent = options?.testDrive ? '测试转向、制动和抓地' : mission?.description ?? `${THEMES[this.options.theme].mechanic}运行中`;
    this.paused = false;
  }

  showHome(): void {
    this.resetStageScroll();
    this.workshop.close();
    byId('main-menu').classList.remove('is-hidden');
    byId('game-over').classList.add('is-hidden');
    byId('pause-overlay').classList.add('is-hidden');
    byId('hud').classList.add('is-hidden');
    byId('boss-hud').classList.add('is-hidden');
    byId('pause-button').classList.add('is-hidden');
    byId('touch-controls').classList.add('is-hidden');
    byId('replay-exit').classList.add('is-hidden');
  }

  showReplay(): void {
    byId('main-menu').classList.add('is-hidden');
    byId('side-panel').classList.add('is-hidden');
    byId('hud').classList.add('is-hidden');
    byId('touch-controls').classList.add('is-hidden');
    byId('replay-exit').classList.remove('is-hidden');
    this.toast('轨迹回放', '半透明机体正在重现最近一场移动路线');
  }

  returnToWorkshop(save: SaveData, message?: string): void {
    this.resetStageScroll();
    byId('hud').classList.add('is-hidden'); byId('touch-controls').classList.add('is-hidden');
    byId('pause-button').classList.add('is-hidden'); byId('boss-hud').classList.add('is-hidden');
    this.workshop.open(save);
    if (message) this.toast('试驾完成', message);
  }

  update(sim: Simulation): void {
    const p1 = sim.players[0]; const p2 = sim.players[1];
    if (p1) {
      const ratio = Math.max(0, p1.hp / p1.maxHp);
      byId('hp-bar').style.width = `${ratio * 100}%`;
      byId('hp-text').textContent = p1.alive ? `${Math.ceil(p1.hp)} / ${p1.maxHp}` : '等待重建';
    }
    if (p2) {
      byId('p2-hp-bar').style.width = `${Math.max(0, p2.hp / p2.maxHp) * 100}%`;
      byId('p2-hp-text').textContent = p2.alive ? `${Math.ceil(p2.hp)} / ${p2.maxHp}` : '等待重建';
    }
    byId('wave-label').textContent = sim.options.testDrive ? `试驾 ${Math.max(0, Math.ceil(20 - sim.elapsed))} 秒` : this.options.mode === 'last-core' ? `安全区 ${sim.safeRadius.toFixed(1)}m` : `第 ${Math.max(1, sim.wave)} 波`;
    byId('score-label').textContent = Math.round(sim.score).toString().padStart(6, '0');
    byId('enemy-label').textContent = `伙伴机 ${sim.enemies.length}`;
    byId('combo-label').textContent = `连击 x${sim.combo}`;
    byId('combo-label').classList.toggle('is-hot', sim.combo >= 3);
    if (sim.options.biome && sim.options.missionId) {
      const progress = `${sim.missionProgressValue} / ${sim.missionTarget}`;
      byId('mission-label').textContent = `${EXPEDITION_MISSIONS[sim.options.missionId].name} · ${sim.missionStageLabel} ${progress}`;
      byId('event-label').textContent = `${SURFACES[sim.players[0]?.surface ?? 'road'].name} · ${WEATHER[sim.weather.id].name}${sim.weather.warning ? '（强天气预警）' : ''}`;
    } else {
      byId('event-label').textContent = sim.options.testDrive ? '跟随发光路线完成操控检查' : sim.eventKind === 'none' ? `${THEMES[this.options.theme].mechanic}运行中` : this.eventName(sim.eventKind);
    }
    const boss = sim.enemies.find((enemy) => enemy.kind === 'boss');
    byId('boss-hud').classList.toggle('is-hidden', !boss);
    if (boss) {
      byId('boss-name').textContent = boss.bossVariant === 'tide-leviathan' ? '潮汐巨鲸 · 霸主' : boss.bossVariant === 'ridge-colossus' ? '云岭巨像 · 霸主' : boss.bossVariant === 'storm-roc' ? '风暴雷鹏 · 霸主' : boss.bossVariant === 'frost-mammoth' ? '极光雪象 · 霸主' : '区域霸主';
      const percent = Math.max(0, boss.hp / boss.maxHp);
      byId('boss-hp-bar').style.width = `${percent * 100}%`;
      byId('boss-hp-text').textContent = `${Math.ceil(percent * 100)}%`;
    }
    if (p1) (Object.keys(p1.abilityCooldowns) as Array<keyof typeof p1.abilityCooldowns>).forEach((key) => {
      const ring = document.querySelector<HTMLElement>(`[data-cooldown="${key}"]`);
      const button = ring?.parentElement;
      const left = p1.abilityCooldowns[key];
      if (ring) ring.textContent = left > 0 ? Math.ceil(left).toString() : '';
      button?.classList.toggle('is-cooling', left > 0);
    });
  }

  showResult(summary: RunSummary): void {
    this.resetStageScroll();
    byId('hud').classList.add('is-hidden'); byId('touch-controls').classList.add('is-hidden');
    byId('pause-button').classList.add('is-hidden'); byId('boss-hud').classList.add('is-hidden');
    byId('game-over').classList.remove('is-hidden');
    const mission = summary.missionId ? EXPEDITION_MISSIONS[summary.missionId] : undefined;
    byId('result-kicker').textContent = mission && summary.missionComplete ? `${SEASONS[mission.season].name}远征完成` : mission ? `${SEASONS[mission.season].name}探索结束` : summary.wave >= 5 ? '闪耀任务完成' : '本次探索完成';
    byId('result-title').textContent = summary.title;
    byId('result-message').textContent = mission && summary.missionComplete ? `${mission.name}目标达成，新路线与任务奖励已记录。` : mission ? `${mission.name}还差一点完成，已经获得的星屑和路线发现仍会保留。` : summary.wave >= 5 ? '你已经能独立守护一座星核基地。' : '带着新收集的星屑回来，下次会走得更远。';
    byId('result-score').textContent = summary.score.toLocaleString('zh-CN');
    byId('result-wave').textContent = summary.wave.toString();
    byId('result-repaired').textContent = summary.repaired.toString();
    byId('result-stars').textContent = `+${summary.stars}`;
  }

  toast(title: string, body: string): void {
    const toast = document.createElement('div'); toast.className = 'toast';
    toast.innerHTML = `<i></i><div><strong>${title}</strong><span>${body}</span></div>`;
    byId('toast-stack').append(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    window.setTimeout(() => { toast.classList.remove('is-visible'); window.setTimeout(() => toast.remove(), 300); }, 2600);
  }

  updatePerformance(quality: RenderQuality, fps: number): void {
    const label = quality === 'high' ? '高画质' : quality === 'balanced' ? '均衡' : '省电';
    byId('quality-label').textContent = `${label} · ${Math.max(1, fps)} FPS`;
  }

  updateGamepad(status: GamepadStatus): void {
    byId('control-status').textContent = status.connected ? `P${status.slot} 手柄 · ${status.name}` : `P${status.slot} 手柄已断开`;
    this.toast(status.connected ? `P${status.slot} 手柄已连接` : `P${status.slot} 手柄断开`, status.connected ? `${status.name} 已完成玩家归属` : '可以继续使用触控或键盘，重新连接后会自动归队');
  }

  setSystemPause(paused: boolean, title = '星核引擎待机中', message = '活动一下手指，准备好后继续。'): void {
    byId('pause-kicker').textContent = paused ? '安全暂停' : '任务暂停';
    byId('pause-title').textContent = title; byId('pause-message').textContent = message;
    this.paused = paused; byId('pause-overlay').classList.toggle('is-hidden', !paused);
  }

  floatText(x: number, y: number, text: string, critical = false): void {
    const node = document.createElement('span'); node.className = `damage-number${critical ? ' critical' : ''}`;
    node.textContent = text; node.style.left = `${x}px`; node.style.top = `${y}px`; byId('damage-layer').append(node);
    window.setTimeout(() => node.remove(), 900);
  }

  private bind(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach((node) => node.classList.remove('is-selected'));
      button.classList.add('is-selected'); this.options.mode = button.dataset.mode as GameOptions['mode'];
    }));
    byId<HTMLSelectElement>('assist-select').addEventListener('change', (event) => { this.options.assist = (event.target as HTMLSelectElement).value as GameOptions['assist']; });
    byId<HTMLSelectElement>('team-select').addEventListener('change', (event) => { this.options.coop = (event.target as HTMLSelectElement).value === 'coop'; });
    byId<HTMLSelectElement>('crew-role-select').addEventListener('change', (event) => { this.options.crewRoleP2 = (event.target as HTMLSelectElement).value as GameOptions['crewRoleP2']; });
    byId<HTMLSelectElement>('quality-select').addEventListener('change', (event) => this.actions.setQuality((event.target as HTMLSelectElement).value as QualitySetting));
    byId('start-button').addEventListener('click', () => this.openWorkshop());
    document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => button.addEventListener('click', () => this.openPanel(button.dataset.panel as PanelName)));
    byId('panel-close').addEventListener('click', () => byId('side-panel').classList.add('is-hidden'));
    byId('restart-button').addEventListener('click', this.actions.restart);
    byId('home-button').addEventListener('click', this.actions.home);
    byId('pause-button').addEventListener('click', () => this.togglePause(true));
    byId('resume-button').addEventListener('click', () => this.togglePause(false));
    byId('quit-button').addEventListener('click', () => { this.togglePause(false); this.actions.home(); });
    byId('replay-exit').addEventListener('click', this.actions.home);
    window.addEventListener('keydown', (event) => { if (event.code === 'Escape' && byId('main-menu').classList.contains('is-hidden')) this.togglePause(!this.paused); });
  }

  private renderThemes(): void {
    const root = byId('theme-selector');
    THEME_ORDER.forEach((id, index) => {
      const theme = THEMES[id];
      const button = document.createElement('button'); button.className = `theme-option${index === 0 ? ' is-selected' : ''}`; button.dataset.theme = id;
      button.style.setProperty('--theme-color', `#${theme.primary.toString(16).padStart(6, '0')}`);
      button.style.setProperty('--theme-ground', `#${theme.ground.toString(16).padStart(6, '0')}`);
      button.innerHTML = `<i><b></b><b></b><b></b></i><span>${theme.name}</span><small>${theme.subtitle}</small>`;
      button.addEventListener('click', () => {
        root.querySelectorAll('.theme-option').forEach((node) => node.classList.remove('is-selected'));
        button.classList.add('is-selected'); this.options.theme = id;
        byId('theme-mechanic').textContent = `场景机制 · ${theme.mechanic}`;
        this.actions.themePreview(id);
      });
      root.append(button);
    });
    const today = seedFromDate(); const daily = DAILY_NAMES[today % DAILY_NAMES.length] ?? DAILY_NAMES[0]!;
    byId('daily-title').textContent = daily;
  }

  private openPanel(panel: PanelName): void {
    this.panel = panel; this.renderPanel(panel); byId('side-panel').classList.remove('is-hidden');
  }

  private renderPanel(panel: PanelName): void {
    if (!this.save) return;
    const root = byId('panel-content');
    if (panel === 'tech') {
      root.innerHTML = `<span class="eyebrow">长期成长</span><h2>永久科技树</h2><p class="panel-intro">星屑不会因为任务结束而消失。选择喜欢的方向，打造属于你的机体。</p><div class="tech-tree"></div>`;
      const tree = root.querySelector('.tech-tree')!;
      TECH_TREE.forEach((node) => {
        const rank = this.save.techRanks[node.id] ?? 0; const maxed = rank >= node.maxRank; const cost = node.costs[rank] ?? 0;
        const locked = Boolean(node.requires && (this.save.techRanks[node.requires] ?? 0) === 0);
        const item = document.createElement('article'); item.className = `tech-node${locked ? ' is-locked' : ''}`;
        item.innerHTML = `<div class="node-icon"><i></i></div><div><span>${node.name}</span><small>${node.description}</small><b>${rank} / ${node.maxRank}</b></div><button ${maxed || locked || this.save.starShards < cost ? 'disabled' : ''}>${maxed ? '已完成' : locked ? '先解锁前置' : `${cost} 星屑`}</button>`;
        item.querySelector('button')?.addEventListener('click', () => this.actions.buyTech(node.id)); tree.append(item);
      });
    } else if (panel === 'armory') {
      root.innerHTML = `<span class="eyebrow">收藏与搭配</span><h2>机体与武器</h2><p class="panel-intro">装备只有玩法差异，没有“唯一最强”。挑选让你觉得最顺手的一套。</p><h3 class="section-title">机体</h3><div class="chassis-list armory-list"></div><h3 class="section-title">武器</h3><div class="weapon-list armory-list"></div>`;
      const chassisList = root.querySelector('.chassis-list')!;
      (Object.keys(CHASSIS) as ChassisId[]).forEach((id) => {
        const chassis = CHASSIS[id]; const unlocked = this.save.unlockedChassis.includes(id); const selected = this.options.chassis === id;
        const item = document.createElement('article'); item.className = `armory-item${selected ? ' is-selected' : ''}`;
        item.innerHTML = `<div class="chassis-glyph" style="--weapon:#${chassis.color.toString(16)}"><i></i><b></b></div><div><span>${chassis.name} · ${chassis.role}</span><small>${chassis.description}</small></div><button ${!unlocked && this.save.starShards < chassis.unlockCost ? 'disabled' : ''}>${selected ? '已装备' : unlocked ? '装备' : `${chassis.unlockCost} 星屑`}</button>`;
        item.querySelector('button')?.addEventListener('click', () => {
          if (unlocked) { this.options.chassis = id; byId('chassis-label').textContent = chassis.name; this.renderPanel('armory'); }
          else this.actions.unlockChassis(id);
        }); chassisList.append(item);
      });
      const list = root.querySelector('.weapon-list')!;
      (Object.keys(WEAPONS) as WeaponId[]).forEach((id) => {
        const weapon = WEAPONS[id]; const unlocked = this.save.unlockedWeapons.includes(id); const selected = this.options.weapon === id;
        const item = document.createElement('article'); item.className = `armory-item${selected ? ' is-selected' : ''}`;
        item.innerHTML = `<div class="weapon-glyph" style="--weapon:#${weapon.color.toString(16)}"><i></i><b></b></div><div><span>${weapon.name}</span><small>${weapon.description}</small></div><button ${!unlocked && this.save.starShards < weapon.unlockCost ? 'disabled' : ''}>${selected ? '已装备' : unlocked ? '装备' : `${weapon.unlockCost} 星屑`}</button>`;
        item.querySelector('button')?.addEventListener('click', () => {
          if (unlocked) { this.options.weapon = id; byId('weapon-label').textContent = weapon.name; this.renderPanel('armory'); }
          else this.actions.unlockWeapon(id);
        }); list.append(item);
      });
    } else if (panel === 'leaderboard') {
      const rows = this.save.leaderboard.length ? this.save.leaderboard.map((run, index) => `<tr><td>${index + 1}</td><td>${run.title}</td><td>${run.score.toLocaleString('zh-CN')}</td><td>第 ${run.wave} 波</td><td>${run.date.slice(5, 10)}</td></tr>`).join('') : '<tr><td colspan="5">完成第一次任务后，你的记录会出现在这里。</td></tr>';
      root.innerHTML = `<span class="eyebrow">本机记录</span><h2>家庭荣耀榜</h2><p class="panel-intro">当前为本地榜单。数据接口已隔离，可在家长同意后接入班级或好友云榜单。</p><div class="table-scroll"><table><thead><tr><th>名次</th><th>称号</th><th>分数</th><th>进度</th><th>日期</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else if (panel === 'replays') {
      root.innerHTML = `<span class="eyebrow">最近 5 场</span><h2>战斗回放</h2><p class="panel-intro">重看自己的移动轨迹，发现一次更聪明的走位。</p><div class="replay-list"></div>`;
      const list = root.querySelector('.replay-list')!;
      if (!this.save.replays.length) list.innerHTML = '<div class="empty-state">还没有回放。完成一场任务后会自动保存。</div>';
      this.save.replays.forEach((replay) => {
        const item = document.createElement('article'); item.className = 'replay-item';
        item.innerHTML = `<div><span>${replay.summary.title}</span><small>${THEMES[replay.options.theme].name} · 第 ${replay.summary.wave} 波 · ${Math.round(replay.summary.duration)} 秒</small></div><button>播放轨迹</button>`;
        item.querySelector('button')?.addEventListener('click', () => { byId('side-panel').classList.add('is-hidden'); this.actions.playReplay(replay); }); list.append(item);
      });
    } else if (panel === 'home') {
      const world = this.save.world;
      const nextXp = VALLEY_LEVEL_XP[world.valleyLevel] ?? VALLEY_LEVEL_XP.at(-1)!;
      const previousXp = VALLEY_LEVEL_XP[world.valleyLevel - 1] ?? 0;
      const ratio = nextXp <= previousXp ? 1 : Math.min(1, (world.valleyXp - previousXp) / (nextXp - previousXp));
      root.innerHTML = `<span class="eyebrow">本机家庭世界</span><h2>伙伴基地</h2><p class="panel-intro">每一局都会让山海谷更明亮。图鉴、地标和伙伴羁绊只记录探索，不制造失败惩罚。</p>
        <section class="home-progress"><div><span>山海谷等级</span><strong>Lv.${world.valleyLevel}</strong><small>${world.valleyXp} / ${nextXp} 探索经验</small></div><i><b style="width:${ratio * 100}%"></b></i><div class="home-stat"><span>已修复地标 <b>${world.restoredLandmarks.length} / ${Object.keys(EXPEDITION_MISSIONS).length}</b></span><span>伙伴图鉴 <b>${world.encyclopedia.length} / ${Object.keys(ENEMIES).length}</b></span></div></section>
        <h3 class="section-title">远征伙伴</h3><div class="companion-grid"></div><h3 class="section-title">机器人图鉴</h3><div class="encyclopedia-grid"></div>`;
      const companions = root.querySelector('.companion-grid')!;
      Object.values(COMPANIONS).forEach((companion) => {
        const unlocked = world.unlockedCompanions.includes(companion.id); const active = world.activeCompanion === companion.id;
        const item = document.createElement('article'); item.className = `companion-card${active ? ' is-active' : ''}${unlocked ? '' : ' is-locked'}`;
        item.style.setProperty('--buddy', `#${companion.color.toString(16).padStart(6, '0')}`);
        item.innerHTML = `<i><b></b></i><div><strong>${companion.name}</strong><span>${companion.personality}</span><small>${companion.perk} · 羁绊 ${world.companionBond[companion.id] ?? 0}</small></div><button ${unlocked ? '' : 'disabled'}>${active ? '同行中' : unlocked ? '邀请同行' : `Lv.${companion.unlockLevel} 解锁`}</button>`;
        item.querySelector('button')?.addEventListener('click', () => this.actions.selectCompanion(companion.id)); companions.append(item);
      });
      const encyclopedia = root.querySelector('.encyclopedia-grid')!;
      Object.values(ENEMIES).forEach((enemy) => {
        const found = world.encyclopedia.includes(enemy.id); const item = document.createElement('article'); item.className = found ? 'is-found' : '';
        item.style.setProperty('--enemy', `#${enemy.color.toString(16).padStart(6, '0')}`);
        item.innerHTML = `<i></i><div><strong>${found ? enemy.name : '等待发现'}</strong><small>${found ? `${enemy.role} · 第 ${enemy.unlockWave} 波起出现` : '在远征中遇见后记录'}</small></div>`; encyclopedia.append(item);
      });
    } else {
      const settings = this.save.settings;
      root.innerHTML = `<span class="eyebrow">家长与辅助设置</span><h2>舒适地一起玩</h2><p class="panel-intro">设置只保存在这台设备。减少闪光、大字和关闭振动可以随时调整，不影响任务奖励。</p><div class="family-settings">
        <label><span><strong>主音量上限</strong><small>限制全部音乐与音效的最大音量</small></span><input data-setting="masterVolume" type="range" min="0" max="1" step="0.05" value="${settings.masterVolume}"><b>${Math.round(settings.masterVolume * 100)}%</b></label>
        <label><span><strong>瞄准灵敏度</strong><small>影响手柄右摇杆和触控瞄准响应</small></span><input data-setting="aimSensitivity" type="range" min="0.55" max="1.75" step="0.05" value="${settings.aimSensitivity}"><b>${settings.aimSensitivity.toFixed(2)}</b></label>
        <label><span><strong>左手布局</strong><small>交换移动区与技能区位置</small></span><input data-setting="leftHanded" type="checkbox" ${settings.leftHanded ? 'checked' : ''}></label>
        <label><span><strong>触觉反馈</strong><small>控制手机振动与手柄震动</small></span><input data-setting="vibration" type="checkbox" ${settings.vibration ? 'checked' : ''}></label>
        <label><span><strong>减少闪光与震屏</strong><small>降低爆炸闪光、粒子密度和镜头震动</small></span><input data-setting="reduceFlashes" type="checkbox" ${settings.reduceFlashes ? 'checked' : ''}></label>
        <label><span><strong>大字模式</strong><small>放大菜单与任务文字</small></span><input data-setting="largeText" type="checkbox" ${settings.largeText ? 'checked' : ''}></label>
        <label><span><strong>手柄摇杆布局</strong><small>标准为左移动右瞄准；左撇子模式相反</small></span><select data-setting="gamepadLayout"><option value="standard" ${settings.gamepadLayout === 'standard' ? 'selected' : ''}>标准布局</option><option value="southpaw" ${settings.gamepadLayout === 'southpaw' ? 'selected' : ''}>左撇子布局</option></select></label>
        <label><span><strong>颜色辅助</strong><small>增强敌我、危险区与可交互物的区分</small></span><select data-setting="colorMode"><option value="default" ${settings.colorMode === 'default' ? 'selected' : ''}>默认色彩</option><option value="deuteranopia" ${settings.colorMode === 'deuteranopia' ? 'selected' : ''}>红绿色弱辅助</option><option value="high-contrast" ${settings.colorMode === 'high-contrast' ? 'selected' : ''}>高对比度</option></select></label>
      </div>`;
      root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach((control) => control.addEventListener('change', () => {
        const key = control.dataset.setting as keyof SaveData['settings'];
        const value = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked
          : control instanceof HTMLInputElement && control.type === 'range' ? Number(control.value) : control.value;
        this.actions.updateSettings({ [key]: value } as Partial<SaveData['settings']>);
      }));
    }
  }

  private togglePause(paused: boolean): void {
    this.setSystemPause(paused); this.actions.pause(paused);
  }

  private openWorkshop(): void {
    if (!this.save) return;
    this.resetStageScroll();
    byId('main-menu').classList.add('is-hidden');
    byId('side-panel').classList.add('is-hidden');
    this.workshop.open(this.save);
  }

  private closeWorkshop(): void {
    this.workshop.close();
    this.actions.closeWorkshop();
    byId('main-menu').classList.remove('is-hidden');
  }

  private optionsWithLoadout(loadout: TankLoadout, testDrive: boolean, season: SeasonId, route: RouteId, missionId: ExpeditionMissionId): GameOptions {
    const options: GameOptions = { ...this.options, chassis: loadout.chassis, loadout, testDrive, biome: 'mountain-sea-valley', season, route, missionId };
    if (options.mode === 'daily') options.seed = seedFromDate(); else delete options.seed;
    return options;
  }

  private updateInputHint(): void {
    const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    byId('control-hint').textContent = touch ? '手机 / Pad 双摇杆' : '键鼠 / 蓝牙手柄';
  }

  private resetStageScroll(): void {
    const stage = document.querySelector<HTMLElement>('.game-stage');
    if (stage) { stage.scrollTop = 0; stage.scrollLeft = 0; }
  }

  private eventName(kind: Simulation['eventKind']): string {
    return WORLD_EVENTS[kind].label;
  }
}
