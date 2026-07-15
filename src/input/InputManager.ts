import type { AbilityId, Vec2 } from '../core/types';
import type { ControlFrame } from '../gameplay/Simulation';

interface PointerState { x: number; y: number; active: boolean }

const ZERO: Vec2 = { x: 0, z: 0 };

export class InputManager {
  private keys = new Set<string>();
  private pressedAbilities = new Set<AbilityId>();
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
    this.bindTouchControls();
  }

  setProjection(fn: (x: number, y: number) => Vec2 | null): void { this.screenToWorld = fn; }
  setPlayerWorld(pos: Vec2): void { this.playerWorld = pos; }

  frame(slot: 1 | 2): ControlFrame {
    const gamepad = this.readGamepad(slot - 1);
    if (slot === 2) {
      return {
        move: gamepad.move.x || gamepad.move.z ? gamepad.move : this.keyboardVector('KeyJ', 'KeyL', 'KeyI', 'KeyK'),
        aim: gamepad.aim.x || gamepad.aim.z ? gamepad.aim : { x: 0, z: -1 },
        firing: gamepad.firing || this.keys.has('Enter'),
        abilities: gamepad.abilities,
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
    this.pressedAbilities.clear();
    return { move, aim, firing: this.touchFiring || this.mouse.active || this.keys.has('Space') || gamepad.firing, abilities };
  }

  private keyboardVector(left: string, right: string, up: string, down: string, left2?: string, right2?: string, up2?: string, down2?: string): Vec2 {
    const x = Number(this.keys.has(right) || Boolean(right2 && this.keys.has(right2))) - Number(this.keys.has(left) || Boolean(left2 && this.keys.has(left2)));
    const z = Number(this.keys.has(down) || Boolean(down2 && this.keys.has(down2))) - Number(this.keys.has(up) || Boolean(up2 && this.keys.has(up2)));
    const l = Math.hypot(x, z);
    return l > 1 ? { x: x / l, z: z / l } : { x, z };
  }

  private readGamepad(index: number): { move: Vec2; aim: Vec2; firing: boolean; abilities: Set<AbilityId> } {
    const pad = navigator.getGamepads?.()[index];
    if (!pad) return { move: { ...ZERO }, aim: { ...ZERO }, firing: false, abilities: new Set() };
    const dead = (value = 0) => Math.abs(value) < .16 ? 0 : value;
    const abilities = new Set<AbilityId>();
    if (pad.buttons[4]?.pressed) abilities.add('shield');
    if (pad.buttons[5]?.pressed) abilities.add('repair');
    if (pad.buttons[1]?.pressed) abilities.add('dash');
    if (pad.buttons[3]?.pressed) abilities.add('storm');
    return {
      move: { x: dead(pad.axes[0]), z: dead(pad.axes[1]) },
      aim: { x: dead(pad.axes[2]), z: dead(pad.axes[3]) },
      firing: Boolean(pad.buttons[7]?.pressed || pad.buttons[0]?.pressed), abilities,
    };
  }

  private bindTouchControls(): void {
    const stick = document.querySelector<HTMLElement>('[data-control="move"]');
    const knob = stick?.querySelector<HTMLElement>('.stick-knob');
    let stickPointer = -1;
    const moveStick = (event: PointerEvent) => {
      if (!stick || event.pointerId !== stickPointer) return;
      const box = stick.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      const radius = box.width * .32;
      const scale = Math.min(1, Math.hypot(dx, dy) / radius);
      const angle = Math.atan2(dy, dx);
      this.touchMove = { x: Math.cos(angle) * scale, z: Math.sin(angle) * scale };
      if (knob) knob.style.transform = `translate(${Math.cos(angle) * scale * radius}px, ${Math.sin(angle) * scale * radius}px)`;
    };
    stick?.addEventListener('pointerdown', (event) => { stickPointer = event.pointerId; stick.setPointerCapture(event.pointerId); moveStick(event); });
    stick?.addEventListener('pointermove', moveStick);
    const endStick = (event: PointerEvent) => {
      if (event.pointerId !== stickPointer) return;
      stickPointer = -1; this.touchMove = { ...ZERO };
      if (knob) knob.style.transform = 'translate(0, 0)';
    };
    stick?.addEventListener('pointerup', endStick);
    stick?.addEventListener('pointercancel', endStick);

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
    fire?.addEventListener('pointerdown', (event) => { firePointer = event.pointerId; this.touchFiring = true; fire.setPointerCapture(event.pointerId); moveFire(event); });
    fire?.addEventListener('pointermove', moveFire);
    const endFire = (event: PointerEvent) => {
      if (event.pointerId !== firePointer) return;
      firePointer = -1; this.touchFiring = false;
      fire?.style.setProperty('--aim-x', '0px'); fire?.style.setProperty('--aim-y', '0px');
    };
    fire?.addEventListener('pointerup', endFire);
    fire?.addEventListener('pointercancel', endFire);

    document.querySelectorAll<HTMLElement>('[data-ability]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.pressedAbilities.add(button.dataset.ability as AbilityId);
        button.classList.add('is-pressed');
      });
      button.addEventListener('pointerup', () => button.classList.remove('is-pressed'));
      button.addEventListener('pointercancel', () => button.classList.remove('is-pressed'));
    });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    const ability: Partial<Record<string, AbilityId>> = { Digit1: 'shield', Digit2: 'repair', Digit3: 'dash', Digit4: 'storm' };
    const selected = ability[event.code];
    if (selected) this.pressedAbilities.add(selected);
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
