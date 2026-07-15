import type { AbilityId, Vec2 } from '../core/types';
import type { ControlFrame } from '../gameplay/Simulation';

interface PointerState { x: number; y: number; active: boolean }
export interface GamepadStatus { slot: 1 | 2; connected: boolean; name: string }
export type InterfaceCommand = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';
export interface GamepadInterfaceEvent { slot: 1 | 2; command: InterfaceCommand }

const ZERO: Vec2 = { x: 0, z: 0 };

export class InputManager {
  private keys = new Set<string>();
  private pressedAbilities = new Set<AbilityId>();
  private pressedAbilitiesP2 = new Set<AbilityId>();
  private pressedAbilityTargets = new Map<AbilityId, Vec2>();
  private ammoSwitchPressed = false;
  private p2AmmoSwitchPressed = false;
  private pingPressed = [false, false];
  private padSwitchHeld = [false, false];
  private padPingHeld = [false, false];
  private padSlots: Array<number | undefined> = [undefined, undefined];
  private gamepadListener?: (status: GamepadStatus) => void;
  private interfaceListener?: (event: GamepadInterfaceEvent) => void;
  private interfaceHeld: Array<Set<InterfaceCommand>> = [new Set(), new Set()];
  private mouse: PointerState = { x: 0, y: 0, active: false };
  private touchMove: Vec2 = { ...ZERO };
  private touchAim: Vec2 = { x: 0, z: -1 };
  private touchFiring = false;
  private playerWorld: Vec2 = { x: 0, z: 0 };
  private screenToWorld: (x: number, y: number) => Vec2 | null = () => null;
  private vibrationEnabled = true;
  private aimSensitivity = 1;
  private gamepadLayout: 'standard' | 'southpaw' = 'standard';
  private readonly pointerResetters = new Set<() => void>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    window.addEventListener('blur', this.resetTransientState);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.resetTransientState(); });
    this.bindTouchControls();
    Array.from(navigator.getGamepads?.() ?? []).forEach((pad) => { if (pad) this.assignGamepad(pad); });
  }

  setProjection(fn: (x: number, y: number) => Vec2 | null): void { this.screenToWorld = fn; }
  setPlayerWorld(pos: Vec2): void { this.playerWorld = pos; }
  setPreferences(settings: { vibration: boolean; aimSensitivity: number; gamepadLayout: 'standard' | 'southpaw' }): void {
    this.vibrationEnabled = settings.vibration; this.aimSensitivity = settings.aimSensitivity; this.gamepadLayout = settings.gamepadLayout;
  }

  resetTransientState = (): void => {
    this.keys.clear(); this.pressedAbilities.clear(); this.pressedAbilitiesP2.clear(); this.pressedAbilityTargets.clear();
    this.ammoSwitchPressed = false; this.p2AmmoSwitchPressed = false; this.pingPressed = [false, false];
    this.padSwitchHeld = [false, false]; this.padPingHeld = [false, false];
    this.interfaceHeld = [new Set(), new Set()];
    this.mouse.active = false; this.touchMove = { ...ZERO }; this.touchAim = { x: 0, z: -1 }; this.touchFiring = false;
    this.pointerResetters.forEach((reset) => reset());
  };
  setGamepadListener(listener: (status: GamepadStatus) => void): void {
    this.gamepadListener = listener;
    this.padSlots.forEach((index, slot) => {
      const pad = index === undefined ? undefined : navigator.getGamepads?.()[index];
      if (pad) listener({ slot: (slot + 1) as 1 | 2, connected: true, name: this.shortPadName(pad.id) });
    });
  }
  setInterfaceListener(listener: (event: GamepadInterfaceEvent) => void): void { this.interfaceListener = listener; }

  pollInterface(): void {
    this.padSlots.forEach((gamepadIndex, index) => {
      const pad = gamepadIndex === undefined ? undefined : navigator.getGamepads?.()[gamepadIndex];
      if (!pad) return;
      const active = new Set<InterfaceCommand>();
      const x = pad.axes[0] ?? 0; const y = pad.axes[1] ?? 0;
      if (pad.buttons[12]?.pressed || y < -.62) active.add('up');
      if (pad.buttons[13]?.pressed || y > .62) active.add('down');
      if (pad.buttons[14]?.pressed || x < -.62) active.add('left');
      if (pad.buttons[15]?.pressed || x > .62) active.add('right');
      if (pad.buttons[0]?.pressed) active.add('confirm');
      if (pad.buttons[1]?.pressed) active.add('back');
      if (pad.buttons[9]?.pressed) active.add('pause');
      active.forEach((command) => { if (!this.interfaceHeld[index]!.has(command)) this.interfaceListener?.({ slot: (index + 1) as 1 | 2, command }); });
      this.interfaceHeld[index] = active;
    });
  }

  rumble(slot: 1 | 2, strength = .35, duration = 70): void {
    if (!this.vibrationEnabled) return;
    const index = this.padSlots[slot - 1];
    const pad = index === undefined ? undefined : navigator.getGamepads?.()[index];
    const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } }) | undefined)?.vibrationActuator;
    void actuator?.playEffect?.('dual-rumble', { duration, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * .65) });
    if (pad && slot === 1 && navigator.vibrate) navigator.vibrate(Math.min(duration, 45));
  }

  frame(slot: 1 | 2): ControlFrame {
    const gamepad = this.readGamepad(slot - 1);
    if (slot === 2) {
      const keyboardMove = this.keyboardVector('KeyJ', 'KeyL', 'KeyI', 'KeyK');
      const keyboardAim = keyboardMove.x || keyboardMove.z ? keyboardMove : { x: 0, z: -1 };
      const padAimActive = Boolean(gamepad.aim.x || gamepad.aim.z);
      const abilities = new Set<AbilityId>([...this.pressedAbilitiesP2, ...gamepad.abilities]);
      const abilityTargets = new Map<AbilityId, Vec2>();
      abilities.forEach((ability) => {
        const target = gamepad.aim.x || gamepad.aim.z ? gamepad.aim : keyboardAim;
        if ((ability === 'dash' || ability === 'storm') && (target.x || target.z)) abilityTargets.set(ability, target);
      });
      const frame: ControlFrame = {
        move: gamepad.move.x || gamepad.move.z ? gamepad.move : keyboardMove,
        aim: gamepad.aim.x || gamepad.aim.z ? gamepad.aim : keyboardAim,
        firing: gamepad.firing || this.keys.has('Enter'),
        abilities,
        abilityTargets,
        switchAmmo: gamepad.switchAmmo || this.p2AmmoSwitchPressed,
        ping: this.consumePing(1, gamepad.ping),
        aimActive: padAimActive || Boolean(keyboardMove.x || keyboardMove.z),
      };
      this.pressedAbilitiesP2.clear(); this.p2AmmoSwitchPressed = false;
      return frame;
    }
    const keyboard = this.keyboardVector('KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown');
    const move = this.touchMove.x || this.touchMove.z ? this.touchMove
      : gamepad.move.x || gamepad.move.z ? gamepad.move : keyboard;
    const world = this.screenToWorld(this.mouse.x, this.mouse.y);
    const mouseAim = world ? { x: world.x - this.playerWorld.x, z: world.z - this.playerWorld.z } : { x: 0, z: -1 };
    const aim = this.touchFiring ? this.touchAim
      : gamepad.aim.x || gamepad.aim.z ? gamepad.aim : mouseAim;
    const abilities = new Set<AbilityId>([...this.pressedAbilities, ...gamepad.abilities]);
    const abilityTargets = new Map(this.pressedAbilityTargets);
    gamepad.abilities.forEach((ability) => {
      if ((ability === 'dash' || ability === 'storm') && (gamepad.aim.x || gamepad.aim.z)) abilityTargets.set(ability, gamepad.aim);
    });
    const switchAmmo = this.ammoSwitchPressed || gamepad.switchAmmo;
    this.pressedAbilities.clear();
    this.pressedAbilityTargets.clear();
    this.ammoSwitchPressed = false;
    return {
      move, aim, firing: this.touchFiring || this.mouse.active || this.keys.has('Space') || gamepad.firing,
      abilities, abilityTargets, switchAmmo, ping: this.consumePing(0, gamepad.ping),
      aimActive: this.touchFiring || this.mouse.active || Boolean(gamepad.aim.x || gamepad.aim.z),
    };
  }

  private consumePing(index: 0 | 1, gamepadPing: boolean): boolean { const value = this.pingPressed[index] || gamepadPing; this.pingPressed[index] = false; return value; }

  private keyboardVector(left: string, right: string, up: string, down: string, left2?: string, right2?: string, up2?: string, down2?: string): Vec2 {
    const x = Number(this.keys.has(right) || Boolean(right2 && this.keys.has(right2))) - Number(this.keys.has(left) || Boolean(left2 && this.keys.has(left2)));
    const z = Number(this.keys.has(down) || Boolean(down2 && this.keys.has(down2))) - Number(this.keys.has(up) || Boolean(up2 && this.keys.has(up2)));
    const l = Math.hypot(x, z);
    return l > 1 ? { x: x / l, z: z / l } : { x, z };
  }

  private readGamepad(index: number): { move: Vec2; aim: Vec2; firing: boolean; abilities: Set<AbilityId>; switchAmmo: boolean; ping: boolean } {
    const gamepadIndex = this.padSlots[index];
    const pad = gamepadIndex === undefined ? undefined : navigator.getGamepads?.()[gamepadIndex];
    if (!pad) return { move: { ...ZERO }, aim: { ...ZERO }, firing: false, abilities: new Set(), switchAmmo: false, ping: false };
    const dead = (value = 0) => {
      const magnitude = Math.abs(value);
      if (magnitude < .14) return 0;
      return Math.sign(value) * Math.pow((magnitude - .14) / .86, 1.12);
    };
    const abilities = new Set<AbilityId>();
    if (pad.buttons[4]?.pressed) abilities.add('shield');
    if (pad.buttons[5]?.pressed) abilities.add('repair');
    if (pad.buttons[1]?.pressed) abilities.add('dash');
    if (pad.buttons[3]?.pressed) abilities.add('storm');
    const held = Boolean(pad.buttons[2]?.pressed); const switchAmmo = held && !this.padSwitchHeld[index]; this.padSwitchHeld[index] = held;
    const pingHeld = Boolean(pad.buttons[8]?.pressed || pad.buttons[12]?.pressed); const ping = pingHeld && !this.padPingHeld[index]; this.padPingHeld[index] = pingHeld;
    const left = { x: dead(pad.axes[0]), z: dead(pad.axes[1]) };
    const right = { x: dead(pad.axes[2]), z: dead(pad.axes[3]) };
    const move = this.gamepadLayout === 'southpaw' ? right : left; const rawAim = this.gamepadLayout === 'southpaw' ? left : right;
    const aim = { x: Math.max(-1, Math.min(1, rawAim.x * this.aimSensitivity)), z: Math.max(-1, Math.min(1, rawAim.z * this.aimSensitivity)) };
    return {
      move,
      aim,
      firing: Boolean(pad.buttons[7]?.pressed || pad.buttons[0]?.pressed), abilities, switchAmmo, ping,
    };
  }

  private bindTouchControls(): void {
    const zone = document.querySelector<HTMLElement>('.move-zone');
    const stick = document.querySelector<HTMLElement>('[data-control="move"]');
    const knob = stick?.querySelector<HTMLElement>('.stick-knob');
    let stickPointer = -1;
    let origin = { x: 0, y: 0 };
    const moveStick = (event: PointerEvent) => {
      if (!stick || event.pointerId !== stickPointer) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      const radius = stick.getBoundingClientRect().width * .34;
      const raw = Math.min(1, Math.hypot(dx, dy) / radius);
      const scale = raw < .055 ? 0 : Math.pow(raw, 1.18);
      const angle = Math.atan2(dy, dx);
      this.touchMove = { x: Math.cos(angle) * scale, z: Math.sin(angle) * scale };
      if (knob) knob.style.transform = `translate(${Math.cos(angle) * scale * radius}px, ${Math.sin(angle) * scale * radius}px)`;
    };
    zone?.addEventListener('pointerdown', (event) => {
      if (!stick || stickPointer >= 0) return;
      stickPointer = event.pointerId; origin = { x: event.clientX, y: event.clientY };
      const zoneBox = zone.getBoundingClientRect();
      const offsetX = Math.max(-28, Math.min(28, origin.x - (zoneBox.left + zoneBox.width / 2)));
      const offsetY = Math.max(-22, Math.min(22, origin.y - (zoneBox.top + zoneBox.height / 2)));
      stick.style.transform = `translate(${offsetX}px, ${offsetY}px)`; stick.classList.add('is-active');
      zone.setPointerCapture(event.pointerId); moveStick(event); this.haptic(12);
    });
    zone?.addEventListener('pointermove', moveStick);
    const endStick = (event: PointerEvent) => {
      if (event.pointerId !== stickPointer) return;
      stickPointer = -1; this.touchMove = { ...ZERO };
      if (knob) knob.style.transform = 'translate(0, 0)';
      if (stick) { stick.style.transform = 'translate(0, 0)'; stick.classList.remove('is-active'); }
    };
    zone?.addEventListener('pointerup', endStick);
    zone?.addEventListener('pointercancel', endStick);
    zone?.addEventListener('lostpointercapture', endStick);
    this.pointerResetters.add(() => endStick({ pointerId: stickPointer } as PointerEvent));

    const fire = document.querySelector<HTMLElement>('[data-control="fire"]');
    let firePointer = -1;
    const moveFire = (event: PointerEvent) => {
      if (!fire || event.pointerId !== firePointer) return;
      const box = fire.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      const length = Math.hypot(dx, dy);
      if (length > 12) {
        const target = { x: dx / length, z: dy / length };
        const response = Math.max(.18, Math.min(.8, .42 * this.aimSensitivity));
        const x = this.touchAim.x + (target.x - this.touchAim.x) * response;
        const z = this.touchAim.z + (target.z - this.touchAim.z) * response;
        const magnitude = Math.hypot(x, z) || 1; this.touchAim = { x: x / magnitude, z: z / magnitude };
      }
      fire.style.setProperty('--aim-x', `${Math.max(-22, Math.min(22, dx))}px`);
      fire.style.setProperty('--aim-y', `${Math.max(-22, Math.min(22, dy))}px`);
    };
    fire?.addEventListener('pointerdown', (event) => { if (firePointer >= 0) return; firePointer = event.pointerId; this.touchFiring = true; fire.setPointerCapture(event.pointerId); fire.classList.add('is-aiming'); moveFire(event); this.haptic(18); });
    fire?.addEventListener('pointermove', moveFire);
    const endFire = (event: PointerEvent) => {
      if (event.pointerId !== firePointer) return;
      firePointer = -1; this.touchFiring = false;
      fire?.style.setProperty('--aim-x', '0px'); fire?.style.setProperty('--aim-y', '0px');
      fire?.classList.remove('is-aiming');
    };
    fire?.addEventListener('pointerup', endFire);
    fire?.addEventListener('pointercancel', endFire);
    fire?.addEventListener('lostpointercapture', endFire);
    this.pointerResetters.add(() => endFire({ pointerId: firePointer } as PointerEvent));

    const touchControls = document.querySelector<HTMLElement>('#touch-controls');
    const cancelZone = document.querySelector<HTMLElement>('#ability-cancel-zone');
    const gestureFeedback = document.querySelector<HTMLElement>('#ability-gesture-feedback');
    document.querySelectorAll<HTMLElement>('[data-ability]').forEach((button) => {
      let abilityPointer = -1;
      let origin = { x: 0, y: 0 };
      let target: Vec2 | undefined;
      let cancelled = false;
      const updateAbilityDrag = (event: PointerEvent) => {
        if (event.pointerId !== abilityPointer) return;
        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        const length = Math.hypot(dx, dy);
        target = length > 12 ? { x: dx / length, z: dy / length } : undefined;
        const cancelBox = cancelZone?.getBoundingClientRect();
        cancelled = Boolean(cancelBox && event.clientX >= cancelBox.left && event.clientX <= cancelBox.right && event.clientY >= cancelBox.top && event.clientY <= cancelBox.bottom);
        cancelZone?.classList.toggle('is-hovered', cancelled);
        button.classList.toggle('is-dragging', length > 12);
        touchControls?.style.setProperty('--skill-x', `${event.clientX}px`);
        touchControls?.style.setProperty('--skill-y', `${event.clientY}px`);
        touchControls?.style.setProperty('--skill-angle', `${Math.atan2(dy, dx)}rad`);
        touchControls?.style.setProperty('--skill-distance', `${Math.min(118, length)}px`);
      };
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (button.classList.contains('is-cooling') || abilityPointer >= 0) return;
        abilityPointer = event.pointerId;
        const box = button.getBoundingClientRect();
        origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        target = undefined; cancelled = false;
        button.setPointerCapture(event.pointerId);
        button.classList.add('is-pressed');
        touchControls?.classList.add('is-targeting-ability');
        gestureFeedback?.classList.add('is-visible');
        updateAbilityDrag(event);
        this.haptic(16);
      });
      button.addEventListener('pointermove', updateAbilityDrag);
      const finishAbility = (event: PointerEvent, forceCancel = false) => {
        if (event.pointerId !== abilityPointer) return;
        const ability = button.dataset.ability as AbilityId;
        updateAbilityDrag(event);
        if (!forceCancel && !cancelled) {
          this.pressedAbilities.add(ability);
          if (target && (ability === 'dash' || ability === 'storm')) this.pressedAbilityTargets.set(ability, target);
          this.haptic(ability === 'storm' ? 38 : 24);
        } else this.haptic(10);
        abilityPointer = -1;
        button.classList.remove('is-pressed', 'is-dragging');
        touchControls?.classList.remove('is-targeting-ability');
        cancelZone?.classList.remove('is-hovered');
        gestureFeedback?.classList.remove('is-visible');
      };
      button.addEventListener('pointerup', (event) => finishAbility(event));
      button.addEventListener('pointercancel', (event) => finishAbility(event, true));
      button.addEventListener('lostpointercapture', (event) => finishAbility(event, true));
      // Some mobile browsers transfer capture during OS gestures; window fallbacks prevent a stuck targeting state.
      window.addEventListener('pointerup', (event) => finishAbility(event));
      window.addEventListener('pointercancel', (event) => finishAbility(event, true));
      this.pointerResetters.add(() => finishAbility({ pointerId: abilityPointer, clientX: origin.x, clientY: origin.y } as PointerEvent, true));
    });
    document.querySelector<HTMLElement>('[data-control="ammo-switch"]')?.addEventListener('pointerdown', (event) => { event.preventDefault(); this.ammoSwitchPressed = true; this.haptic(18); });
    document.querySelector<HTMLElement>('[data-control="marker"]')?.addEventListener('pointerdown', (event) => { event.preventDefault(); this.pingPressed[0] = true; this.haptic(20); });
  }

  private assignGamepad(pad: Gamepad): void {
    if (this.padSlots.includes(pad.index)) return;
    const free = this.padSlots.findIndex((value) => value === undefined);
    if (free < 0) return;
    this.padSlots[free] = pad.index;
    this.gamepadListener?.({ slot: (free + 1) as 1 | 2, connected: true, name: this.shortPadName(pad.id) });
  }

  private shortPadName(id: string): string { return id.replace(/\([^)]*\)/g, '').replace(/vendor:|product:/gi, '').trim().slice(0, 28) || '蓝牙手柄'; }
  private haptic(duration: number): void { if (this.vibrationEnabled && navigator.vibrate) navigator.vibrate(duration); }
  private onGamepadConnected = (event: GamepadEvent): void => this.assignGamepad(event.gamepad);
  private onGamepadDisconnected = (event: GamepadEvent): void => {
    const slot = this.padSlots.findIndex((index) => index === event.gamepad.index);
    if (slot < 0) return;
    this.padSlots[slot] = undefined; this.padSwitchHeld[slot] = false; this.padPingHeld[slot] = false;
    this.gamepadListener?.({ slot: (slot + 1) as 1 | 2, connected: false, name: this.shortPadName(event.gamepad.id) });
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    this.keys.add(event.code);
    const ability: Partial<Record<string, AbilityId>> = { Digit1: 'shield', Digit2: 'repair', Digit3: 'dash', Digit4: 'storm' };
    const p2Ability: Partial<Record<string, AbilityId>> = { Digit7: 'shield', Digit8: 'repair', Digit9: 'dash', Digit0: 'storm' };
    const selected = ability[event.code];
    if (selected) this.pressedAbilities.add(selected);
    const selectedP2 = p2Ability[event.code]; if (selectedP2) this.pressedAbilitiesP2.add(selectedP2);
    if (event.code === 'KeyQ') this.ammoSwitchPressed = true;
    if (event.code === 'KeyO') this.p2AmmoSwitchPressed = true;
    if (event.code === 'KeyC') this.pingPressed[0] = true;
    if (event.code === 'KeyU') this.pingPressed[1] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    this.mouse.x = event.clientX; this.mouse.y = event.clientY;
  };
  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    this.mouse.active = event.button === 0;
    this.mouse.x = event.clientX; this.mouse.y = event.clientY;
  };
  private onPointerUp = (event: PointerEvent): void => { if (event.pointerType !== 'touch') this.mouse.active = false; };
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : undefined;
  return Boolean(element?.closest('input, select, textarea, button, [contenteditable="true"]'));
}
