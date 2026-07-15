import type { AbilityId, Vec2 } from '../core/types';
import type { ControlFrame } from '../gameplay/Simulation';

interface PointerState { x: number; y: number; active: boolean }
export interface GamepadStatus { slot: 1 | 2; connected: boolean; name: string }

const ZERO: Vec2 = { x: 0, z: 0 };

export class InputManager {
  private keys = new Set<string>();
  private pressedAbilities = new Set<AbilityId>();
  private ammoSwitchPressed = false;
  private padSwitchHeld = [false, false];
  private padSlots: Array<number | undefined> = [undefined, undefined];
  private gamepadListener?: (status: GamepadStatus) => void;
  private mouse: PointerState = { x: 0, y: 0, active: false };
  private touchMove: Vec2 = { ...ZERO };
  private touchAim: Vec2 = { x: 0, z: -1 };
  private touchFiring = false;
  private playerWorld: Vec2 = { x: 0, z: 0 };
  private screenToWorld: (x: number, y: number) => Vec2 | null = () => null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected);
    this.bindTouchControls();
    Array.from(navigator.getGamepads?.() ?? []).forEach((pad) => { if (pad) this.assignGamepad(pad); });
  }

  setProjection(fn: (x: number, y: number) => Vec2 | null): void { this.screenToWorld = fn; }
  setPlayerWorld(pos: Vec2): void { this.playerWorld = pos; }
  setGamepadListener(listener: (status: GamepadStatus) => void): void {
    this.gamepadListener = listener;
    this.padSlots.forEach((index, slot) => {
      const pad = index === undefined ? undefined : navigator.getGamepads?.()[index];
      if (pad) listener({ slot: (slot + 1) as 1 | 2, connected: true, name: this.shortPadName(pad.id) });
    });
  }

  rumble(slot: 1 | 2, strength = .35, duration = 70): void {
    const index = this.padSlots[slot - 1];
    const pad = index === undefined ? undefined : navigator.getGamepads?.()[index];
    const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } }) | undefined)?.vibrationActuator;
    void actuator?.playEffect?.('dual-rumble', { duration, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * .65) });
    if (pad && slot === 1 && navigator.vibrate) navigator.vibrate(Math.min(duration, 45));
  }

  frame(slot: 1 | 2): ControlFrame {
    const gamepad = this.readGamepad(slot - 1);
    if (slot === 2) {
      return {
        move: gamepad.move.x || gamepad.move.z ? gamepad.move : this.keyboardVector('KeyJ', 'KeyL', 'KeyI', 'KeyK'),
        aim: gamepad.aim.x || gamepad.aim.z ? gamepad.aim : { x: 0, z: -1 },
        firing: gamepad.firing || this.keys.has('Enter'),
        abilities: gamepad.abilities,
        switchAmmo: gamepad.switchAmmo,
      };
    }
    const keyboard = this.keyboardVector('KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown');
    const move = this.touchMove.x || this.touchMove.z ? this.touchMove
      : gamepad.move.x || gamepad.move.z ? gamepad.move : keyboard;
    const world = this.screenToWorld(this.mouse.x, this.mouse.y);
    const mouseAim = world ? { x: world.x - this.playerWorld.x, z: world.z - this.playerWorld.z } : { x: 0, z: -1 };
    const aim = this.touchFiring ? this.touchAim
      : gamepad.aim.x || gamepad.aim.z ? gamepad.aim : mouseAim;
    const abilities = new Set<AbilityId>([...this.pressedAbilities, ...gamepad.abilities]);
    const switchAmmo = this.ammoSwitchPressed || gamepad.switchAmmo;
    this.pressedAbilities.clear();
    this.ammoSwitchPressed = false;
    return { move, aim, firing: this.touchFiring || this.mouse.active || this.keys.has('Space') || gamepad.firing, abilities, switchAmmo };
  }

  private keyboardVector(left: string, right: string, up: string, down: string, left2?: string, right2?: string, up2?: string, down2?: string): Vec2 {
    const x = Number(this.keys.has(right) || Boolean(right2 && this.keys.has(right2))) - Number(this.keys.has(left) || Boolean(left2 && this.keys.has(left2)));
    const z = Number(this.keys.has(down) || Boolean(down2 && this.keys.has(down2))) - Number(this.keys.has(up) || Boolean(up2 && this.keys.has(up2)));
    const l = Math.hypot(x, z);
    return l > 1 ? { x: x / l, z: z / l } : { x, z };
  }

  private readGamepad(index: number): { move: Vec2; aim: Vec2; firing: boolean; abilities: Set<AbilityId>; switchAmmo: boolean } {
    const gamepadIndex = this.padSlots[index];
    const pad = gamepadIndex === undefined ? undefined : navigator.getGamepads?.()[gamepadIndex];
    if (!pad) return { move: { ...ZERO }, aim: { ...ZERO }, firing: false, abilities: new Set(), switchAmmo: false };
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
    return {
      move: { x: dead(pad.axes[0]), z: dead(pad.axes[1]) },
      aim: { x: dead(pad.axes[2]), z: dead(pad.axes[3]) },
      firing: Boolean(pad.buttons[7]?.pressed || pad.buttons[0]?.pressed), abilities, switchAmmo,
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

    const fire = document.querySelector<HTMLElement>('[data-control="fire"]');
    let firePointer = -1;
    const moveFire = (event: PointerEvent) => {
      if (!fire || event.pointerId !== firePointer) return;
      const box = fire.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      if (Math.hypot(dx, dy) > 12) this.touchAim = { x: dx, z: dy };
      fire.style.setProperty('--aim-x', `${Math.max(-22, Math.min(22, dx))}px`);
      fire.style.setProperty('--aim-y', `${Math.max(-22, Math.min(22, dy))}px`);
    };
    fire?.addEventListener('pointerdown', (event) => { firePointer = event.pointerId; this.touchFiring = true; fire.setPointerCapture(event.pointerId); fire.classList.add('is-aiming'); moveFire(event); this.haptic(18); });
    fire?.addEventListener('pointermove', moveFire);
    const endFire = (event: PointerEvent) => {
      if (event.pointerId !== firePointer) return;
      firePointer = -1; this.touchFiring = false;
      fire?.style.setProperty('--aim-x', '0px'); fire?.style.setProperty('--aim-y', '0px');
      fire?.classList.remove('is-aiming');
    };
    fire?.addEventListener('pointerup', endFire);
    fire?.addEventListener('pointercancel', endFire);

    document.querySelectorAll<HTMLElement>('[data-ability]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.pressedAbilities.add(button.dataset.ability as AbilityId);
        button.classList.add('is-pressed');
        this.haptic(24);
      });
      button.addEventListener('pointerup', () => button.classList.remove('is-pressed'));
      button.addEventListener('pointercancel', () => button.classList.remove('is-pressed'));
    });
    document.querySelector<HTMLElement>('[data-control="ammo-switch"]')?.addEventListener('pointerdown', (event) => { event.preventDefault(); this.ammoSwitchPressed = true; this.haptic(18); });
  }

  private assignGamepad(pad: Gamepad): void {
    if (this.padSlots.includes(pad.index)) return;
    const free = this.padSlots.findIndex((value) => value === undefined);
    if (free < 0) return;
    this.padSlots[free] = pad.index;
    this.gamepadListener?.({ slot: (free + 1) as 1 | 2, connected: true, name: this.shortPadName(pad.id) });
  }

  private shortPadName(id: string): string { return id.replace(/\([^)]*\)/g, '').replace(/vendor:|product:/gi, '').trim().slice(0, 28) || '蓝牙手柄'; }
  private haptic(duration: number): void { if (navigator.vibrate) navigator.vibrate(duration); }
  private onGamepadConnected = (event: GamepadEvent): void => this.assignGamepad(event.gamepad);
  private onGamepadDisconnected = (event: GamepadEvent): void => {
    const slot = this.padSlots.findIndex((index) => index === event.gamepad.index);
    if (slot < 0) return;
    this.padSlots[slot] = undefined; this.padSwitchHeld[slot] = false;
    this.gamepadListener?.({ slot: (slot + 1) as 1 | 2, connected: false, name: this.shortPadName(event.gamepad.id) });
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    const ability: Partial<Record<string, AbilityId>> = { Digit1: 'shield', Digit2: 'repair', Digit3: 'dash', Digit4: 'storm' };
    const selected = ability[event.code];
    if (selected) this.pressedAbilities.add(selected);
    if (event.code === 'KeyQ') this.ammoSwitchPressed = true;
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
