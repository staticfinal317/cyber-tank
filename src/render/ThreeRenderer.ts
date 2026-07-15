import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ENEMIES } from '../content/enemies';
import { THEMES } from '../content/themes';
import { MOVEMENT_MODULES, PAINTS } from '../content/expedition';
import type { MovementModuleId, TankLoadout, ThemeDefinition, Vec2 } from '../core/types';
import type { EnemyEntity, PickupEntity, PlayerEntity, ProjectileEntity, Simulation } from '../gameplay/Simulation';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: THREE.Vector3;
}

function material(color: number, emissive = color, intensity = .65, roughness = .32): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness, metalness: .7 });
}

function roundedBox(width: number, height: number, depth: number, radius: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  const x = -width / 2; const y = -depth / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + depth - radius);
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth);
  shape.lineTo(x + radius, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .05, bevelThickness: .05 });
  geometry.rotateX(Math.PI / 2);
  geometry.center();
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

export class ThreeRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, .1, 150);
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly playerMeshes = new Map<number, THREE.Group>();
  private readonly enemyMeshes = new Map<number, THREE.Group>();
  private readonly bulletMeshes = new Map<number, THREE.Mesh>();
  private readonly pickupMeshes = new Map<number, THREE.Group>();
  private readonly particles: Particle[] = [];
  private readonly world = new THREE.Group();
  private readonly entityRoot = new THREE.Group();
  private readonly effectRoot = new THREE.Group();
  private safeZone?: THREE.Mesh;
  private simulation?: Simulation;
  private shakePower = 0;
  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private elapsed = 0;
  private resizeObserver: ResizeObserver;
  private replayFrames: import('../core/types').ReplayFrame[] = [];
  private replayStart = 0;
  private replayGhosts: THREE.Group[] = [];
  private viewMode: 'arena' | 'workshop' = 'arena';
  private workshopTank?: THREE.Group;
  private workshopTurntable?: THREE.Group;
  private workshopArm?: THREE.Group;
  private workshopAngle = -.5;
  private workshopRadius = 10.5;
  private workshopDragging = false;
  private workshopPointerX = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private theme: ThemeDefinition) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 20.5, 18.5);
    this.camera.lookAt(this.cameraTarget);

    const renderPass = new RenderPass(this.scene, this.camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .78, .5, .55);
    bloom.threshold = .74; bloom.strength = .52; bloom.radius = .42; this.bloom = bloom;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(bloom);
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null }, amount: { value: .00115 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv; void main(){ float r=texture2D(tDiffuse,vUv+vec2(amount,0.0)).r; float g=texture2D(tDiffuse,vUv).g; float b=texture2D(tDiffuse,vUv-vec2(amount,0.0)).b; gl_FragColor=vec4(r,g,b,1.0); }',
    }));
    this.composer.addPass(new OutputPass());

    this.scene.add(this.world, this.entityRoot, this.effectRoot);
    this.buildWorld(theme);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    canvas.addEventListener('pointerdown', this.onWorkshopPointerDown);
    canvas.addEventListener('pointermove', this.onWorkshopPointerMove);
    window.addEventListener('pointerup', this.onWorkshopPointerUp);
    canvas.addEventListener('wheel', this.onWorkshopWheel, { passive: false });
    this.resize();
  }

  setSimulation(simulation: Simulation): void {
    this.viewMode = 'arena';
    this.simulation = simulation;
    this.stopReplay();
    this.clearEntities();
  }

  clearSimulation(): void {
    this.simulation = undefined;
    this.clearEntities();
  }

  startReplay(frames: import('../core/types').ReplayFrame[]): void {
    this.clearSimulation();
    this.stopReplay();
    this.replayFrames = frames;
    this.replayStart = performance.now();
    const ghost1 = this.createTank(1); const ghost2 = this.createTank(2);
    [ghost1, ghost2].forEach((ghost) => {
      ghost.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const cloned = child.material.clone(); cloned.transparent = true; cloned.opacity = .44; cloned.depthWrite = false; child.material = cloned;
        }
      });
      this.entityRoot.add(ghost);
    });
    ghost2.visible = frames.some((frame) => frame.p2x !== undefined);
    this.replayGhosts = [ghost1, ghost2];
  }

  stopReplay(): void {
    this.replayGhosts.forEach((ghost) => this.entityRoot.remove(ghost));
    this.replayGhosts = []; this.replayFrames = [];
  }

  setTheme(id: ThemeDefinition['id']): void {
    this.viewMode = 'arena';
    this.renderer.toneMappingExposure = .92; this.bloom.threshold = .74; this.bloom.strength = .52; this.bloom.radius = .42;
    this.theme = THEMES[id];
    while (this.world.children.length) this.world.remove(this.world.children[0]!);
    this.buildWorld(this.theme);
  }

  showWorkshop(loadout: TankLoadout): void {
    this.simulation = undefined;
    this.stopReplay();
    this.clearEntities();
    this.viewMode = 'workshop';
    this.renderer.toneMappingExposure = .58; this.bloom.threshold = .88; this.bloom.strength = .26; this.bloom.radius = .28;
    while (this.world.children.length) this.world.remove(this.world.children[0]!);
    this.buildWorkshop(loadout);
  }

  updateWorkshopLoadout(loadout: TankLoadout): void {
    if (this.viewMode !== 'workshop') return;
    if (this.workshopTank) this.entityRoot.remove(this.workshopTank);
    this.workshopTank = this.createTank(1, loadout);
    this.workshopTank.scale.setScalar(1.72);
    this.workshopTank.position.set(-.55, .48, .1);
    this.workshopTank.rotation.y = .72;
    const tankBuddy = this.workshopTank.userData.companion as THREE.Group | undefined; if (tankBuddy) tankBuddy.visible = false;
    this.entityRoot.add(this.workshopTank);
    this.playInstallFeedback(loadout.movement);
  }

  render(dt: number): void {
    this.elapsed += dt;
    if (this.simulation) this.sync(this.simulation);
    this.updateReplay();
    this.updateParticles(dt);
    const shake = this.shakePower;
    this.shakePower = Math.max(0, this.shakePower - dt * 3.8);
    const x = (Math.random() - .5) * shake;
    const y = (Math.random() - .5) * shake * .5;
    if (this.viewMode === 'workshop') {
      const wx = Math.sin(this.workshopAngle) * this.workshopRadius;
      const wz = Math.cos(this.workshopAngle) * this.workshopRadius;
      this.camera.position.set(wx, 4.4, wz);
      this.camera.lookAt(-.35, 1.78, .2);
      if (this.workshopTurntable) this.workshopTurntable.rotation.y += dt * .08;
      if (this.workshopTank && !this.workshopDragging) this.workshopTank.rotation.y += dt * .07;
      if (this.workshopArm) this.workshopArm.rotation.y = -.6 + Math.sin(this.elapsed * .85) * .08;
    } else {
      this.camera.position.set(x, 20.5 + y, 18.5 + y);
      this.camera.lookAt(this.cameraTarget.x + x * .25, this.cameraTarget.y, this.cameraTarget.z + y * .2);
    }
    this.world.rotation.y = Math.sin(this.elapsed * .09) * .002;
    this.composer.render();
  }

  screenToGround(clientX: number, clientY: number): Vec2 | null {
    const box = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return null;
    return { x: point.x, z: point.z };
  }

  worldToScreen(pos: Vec2, height = 1): { x: number; y: number; visible: boolean } {
    const p = new THREE.Vector3(pos.x, height, pos.z).project(this.camera);
    const box = this.canvas.getBoundingClientRect();
    return { x: box.left + (p.x + 1) * box.width / 2, y: box.top + (-p.y + 1) * box.height / 2, visible: p.z < 1 };
  }

  burst(pos: Vec2, color: number, heavy = false): void {
    const count = heavy ? 32 : 10;
    for (let i = 0; i < count; i += 1) {
      const isDebris = i % 3 === 0;
      const geometry = isDebris ? new THREE.BoxGeometry(.12, .1, .2) : new THREE.SphereGeometry(.07, 5, 4);
      const mesh = new THREE.Mesh(geometry, material(i % 4 === 0 ? 0xffd65a : color, color, 2.2));
      mesh.position.set(pos.x, .5 + Math.random() * .7, pos.z);
      this.effectRoot.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = (heavy ? 3.5 : 2) + Math.random() * (heavy ? 7 : 3);
      const maxLife = .35 + Math.random() * (heavy ? .75 : .35);
      this.particles.push({
        mesh, velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.random() * (heavy ? 6 : 3), Math.sin(angle) * speed),
        life: maxLife, maxLife, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      });
    }
    this.shakePower = Math.max(this.shakePower, heavy ? .75 : .16);
    const flash = new THREE.PointLight(color, heavy ? 12 : 5, heavy ? 10 : 4, 2);
    flash.position.set(pos.x, 1.3, pos.z); this.effectRoot.add(flash);
    window.setTimeout(() => this.effectRoot.remove(flash), heavy ? 130 : 70);
  }

  muzzle(pos: Vec2, color: number): void {
    const flash = new THREE.PointLight(color, 4, 3.5, 2);
    flash.position.set(pos.x, 1.1, pos.z); this.effectRoot.add(flash);
    window.setTimeout(() => this.effectRoot.remove(flash), 45);
  }

  ability(pos: Vec2, color: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.5, .7, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, .08, pos.z); this.effectRoot.add(ring);
    const start = performance.now();
    const animate = () => {
      const t = (performance.now() - start) / 520;
      if (t >= 1) { this.effectRoot.remove(ring); return; }
      ring.scale.setScalar(1 + t * 9); (ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      requestAnimationFrame(animate);
    };
    animate();
  }

  private buildWorld(theme: ThemeDefinition): void {
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.FogExp2(theme.fog, .018);

    const ambient = new THREE.HemisphereLight(theme.primary, theme.ground, 1.6);
    const sun = new THREE.DirectionalLight(0xfff1d2, 2.7);
    sun.position.set(-7, 18, 10); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18; sun.shadow.camera.right = 18; sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
    const accent = new THREE.PointLight(theme.primary, 12, 30, 2);
    accent.position.set(0, 7, -8);
    this.world.add(ambient, sun, accent);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 30),
      new THREE.MeshStandardMaterial({ color: theme.ground, roughness: .7, metalness: .25 }),
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.08; ground.receiveShadow = true;
    this.world.add(ground);
    const grid = new THREE.GridHelper(30, 30, theme.grid, theme.grid);
    grid.material.transparent = true; grid.material.opacity = .2; grid.position.y = .005;
    this.world.add(grid);

    const borderMat = new THREE.MeshStandardMaterial({ color: theme.primary, emissive: theme.primary, emissiveIntensity: 1.3, metalness: .8, roughness: .2 });
    const rails = [
      [0, .12, -11.3, 26, .12, .18], [0, .12, 11.3, 26, .12, .18],
      [-13.3, .12, 0, .18, .12, 22.5], [13.3, .12, 0, .18, .12, 22.5],
    ];
    rails.forEach(([x, y, z, w, h, d]) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), borderMat); rail.position.set(x!, y!, z!); this.world.add(rail);
    });
    this.addThemeProps(theme);

    this.safeZone = new THREE.Mesh(
      new THREE.RingGeometry(.985, 1, 96),
      new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: .7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.safeZone.rotation.x = -Math.PI / 2; this.safeZone.position.y = .035; this.safeZone.visible = false;
    this.world.add(this.safeZone);
  }

  private buildWorkshop(loadout: TankLoadout): void {
    this.scene.background = new THREE.Color(0x4d8fa8);
    this.scene.fog = new THREE.FogExp2(0x5d9bab, .013);
    const hemi = new THREE.HemisphereLight(0xc8efff, 0x172116, 1.05);
    const sun = new THREE.DirectionalLight(0xfff0ca, 1.75); sun.position.set(-8, 14, 10); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const cyan = new THREE.PointLight(0x32ddff, 4.8, 16, 2); cyan.position.set(-1, 4, 2);
    this.world.add(hemi, sun, cyan);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 24), new THREE.MeshStandardMaterial({ color: 0x0a151f, metalness: .72, roughness: .34 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.world.add(floor);
    const hangar = material(0x101b24, 0x142c38, .2, .52);
    const beams = [[-8, 4, 0, .45, 8, 18], [8, 4, 0, .45, 8, 18], [0, 7.7, -3, 16, .42, .55]];
    beams.forEach(([x, y, z, w, h, d]) => { const beam = new THREE.Mesh(new THREE.BoxGeometry(w!, h!, d!), hangar); beam.position.set(x!, y!, z!); beam.castShadow = true; this.world.add(beam); });

    // Layered mountain-and-sea destination visible through the hangar mouth.
    const skyWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshBasicMaterial({ color: 0x79bed2, fog: false }));
    skyWall.position.set(0, 5.4, -11.8); this.world.add(skyWall);
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshBasicMaterial({ color: 0xffefba, transparent: true, opacity: .92, fog: false }));
    sunDisc.position.set(6.5, 7.5, -11.65); this.world.add(sunDisc);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(30, 18, 16, 16), new THREE.MeshPhysicalMaterial({ color: 0x2aa5bd, emissive: 0x073f51, emissiveIntensity: .12, roughness: .18, metalness: .1, transparent: true, opacity: .94 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, -.12, -14); this.world.add(water);
    const mountainMat = material(0x4e8d65, 0x102d2a, .06, .9);
    for (let i = 0; i < 11; i += 1) {
      const height = 3.2 + (i % 4) * 1.2;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(2.2 + (i % 3) * .6, height, 7), mountainMat);
      mountain.position.set(-14 + i * 2.8, height / 2 - .35, -9.8 - Math.abs(5 - i) * .28); mountain.rotation.y = i * .37; this.world.add(mountain);
    }
    const cliffMat = material(0x355f49, 0x17392d, .08, .82);
    const cliff = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.8, 1.5), cliffMat); cliff.position.set(4.7, 2.15, -8.8); cliff.rotation.z = -.08; this.world.add(cliff);
    const waterfall = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 4.15, 1, 10), new THREE.MeshBasicMaterial({ color: 0xbdf7ff, transparent: true, opacity: .82, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    waterfall.position.set(4.25, 2.35, -7.98); waterfall.rotation.z = -.08; this.world.add(waterfall);
    const treeTrunkMat = material(0x5a3c26, 0x1d100b, .04, .9); const leafMat = material(0x6dbb69, 0x244d31, .1, .8); const blossomMat = material(0xffacd0, 0x7d294e, .14, .78);
    for (let i = 0; i < 14; i += 1) {
      const tree = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, .75, 7), treeTrunkMat); trunk.position.y = .37; tree.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.38 + (i % 3) * .06, 1), i % 3 === 0 ? blossomMat : leafMat); crown.position.y = .88; crown.scale.set(1.2, .95, 1); tree.add(crown);
      tree.position.set(-9 + (i * 1.55) % 18, .1, -7.3 - (i % 3) * .75); this.world.add(tree);
    }
    const petalMat = new THREE.MeshBasicMaterial({ color: 0xffb6d2, transparent: true, opacity: .8 });
    for (let i = 0; i < 32; i += 1) { const petal = new THREE.Mesh(new THREE.SphereGeometry(.035, 5, 4), petalMat); petal.scale.set(2, .25, 1); petal.position.set(-8 + Math.random() * 16, .5 + Math.random() * 6, -3 - Math.random() * 14); petal.userData.baseY = petal.position.y; this.world.add(petal); }

    const platform = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.55, 3.8, .38, 64), material(0x17242e, 0x18bddc, .36, .25)); disc.position.y = .18; disc.receiveShadow = true; platform.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.25, .08, 8, 64), new THREE.MeshBasicMaterial({ color: 0x41eaff })); ring.rotation.x = Math.PI / 2; ring.position.y = .4; platform.add(ring);
    this.workshopTurntable = platform; this.world.add(platform);

    this.workshopArm = this.createWorkshopArm(); this.workshopArm.position.set(3.5, .2, .8); this.world.add(this.workshopArm);
    this.workshopTank = this.createTank(1, loadout); this.workshopTank.scale.setScalar(1.72); this.workshopTank.position.set(-.55, .48, .1); this.workshopTank.rotation.y = .72; this.entityRoot.add(this.workshopTank);
    const tankBuddy = this.workshopTank.userData.companion as THREE.Group | undefined; if (tankBuddy) tankBuddy.visible = false;
    const workshopBuddy = this.createWorkshopBuddy(); workshopBuddy.position.set(-3.35, .42, 1.1); workshopBuddy.rotation.y = .35; this.world.add(workshopBuddy);
  }

  private createWorkshopArm(): THREE.Group {
    const root = new THREE.Group(); const yellow = material(0xffc928, 0xffa818, .85, .3); const dark = material(0x15212a, 0x18cbe8, .18, .45);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.65, .8, .38, 16), dark); base.position.y = .2; root.add(base);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(.42, 12, 8), yellow); shoulder.position.y = 1.1; root.add(shoulder);
    const lower = roundedBox(.34, 2.1, .42, .13, yellow); lower.position.set(0, 2, 0); lower.rotation.z = -.34; root.add(lower);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(.34, 12, 8), dark); elbow.position.set(.68, 2.95, 0); root.add(elbow);
    const upper = roundedBox(.28, 1.6, .34, .1, yellow); upper.position.set(1.18, 3.55, 0); upper.rotation.z = -.8; root.add(upper);
    const tool = new THREE.Mesh(new THREE.TorusGeometry(.32, .08, 8, 24), new THREE.MeshBasicMaterial({ color: 0x40e9ff })); tool.position.set(1.74, 4.05, 0); tool.rotation.y = Math.PI / 2; root.add(tool);
    return root;
  }

  private createWorkshopBuddy(): THREE.Group {
    const root = new THREE.Group(); const shell = material(0xe8f4f4, 0x35e8ff, .18, .35); const yellow = material(0xffc928, 0xffa818, .38, .3); const dark = material(0x0c1721, 0x173545, .16, .38); const cyan = material(0x56efff, 0x35e8ff, 1.2, .2);
    const body = roundedBox(.72, .62, .62, .2, shell); body.position.y = .68; root.add(body);
    const face = roundedBox(.53, .07, .34, .12, dark); face.position.set(0, .73, .325); root.add(face);
    for (const x of [-.13, .13]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 7), cyan); eye.position.set(x, .77, .37); root.add(eye); }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .34, 7), yellow); antenna.position.set(.17, 1.12, 0); antenna.rotation.z = -.28; root.add(antenna);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.075, 10, 7), cyan); tip.position.set(.22, 1.28, 0); root.add(tip);
    for (const x of [-.22, .22]) { const foot = roundedBox(.18, .16, .28, .06, yellow); foot.position.set(x, .13, .03); root.add(foot); const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .28, 4, 8), shell); arm.position.set(x * 1.48, .64, 0); arm.rotation.z = x > 0 ? -.35 : .35; root.add(arm); }
    return root;
  }

  private playInstallFeedback(movement: MovementModuleId): void {
    const color = MOVEMENT_MODULES[movement].color;
    for (let i = 0; i < 16; i += 1) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(.035, 5, 4), new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending }));
      mesh.position.set(.8, 1.15, .2); this.effectRoot.add(mesh);
      const angle = i / 16 * Math.PI * 2; const maxLife = .45 + Math.random() * .25;
      this.particles.push({ mesh, velocity: new THREE.Vector3(Math.cos(angle) * (1.2 + Math.random()), Math.random() * 2.4, Math.sin(angle) * (1.2 + Math.random())), life: maxLife, maxLife, spin: new THREE.Vector3() });
    }
  }

  private addThemeProps(theme: ThemeDefinition): void {
    const propMat = material(theme.primary, theme.primary, .75, .42);
    const accentMat = material(theme.accent, theme.accent, 1.1, .28);
    const positions = [[-10, -7], [9, -6], [-10, 6], [10, 7], [-7, 9], [7, -9]];
    positions.forEach(([x, z], index) => {
      const group = new THREE.Group(); group.position.set(x!, 0, z!);
      if (theme.id === 'neon-city') {
        const tower = roundedBox(1.5, 2.5 + index % 3, 1.5, .18, index % 2 ? propMat : accentMat); tower.position.y = 1.25; group.add(tower);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(.9, .06, .3), accentMat); sign.position.set(0, 2.2, .78); group.add(sign);
      } else if (theme.id === 'cloud-garden') {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(.1, .2, 1.8, 8), propMat); stem.position.y = .9; group.add(stem);
        for (let p = 0; p < 5; p += 1) { const petal = new THREE.Mesh(new THREE.SphereGeometry(.36, 9, 6), p % 2 ? propMat : accentMat); petal.scale.set(1, .3, .65); petal.position.set(Math.cos(p * 1.256) * .55, 1.85, Math.sin(p * 1.256) * .55); group.add(petal); }
      } else if (theme.id === 'toy-factory') {
        for (let b = 0; b < 3; b += 1) { const cube = roundedBox(.9, .7, .9, .12, b % 2 ? propMat : accentMat); cube.position.set((b - 1) * .55, .35 + b * .45, 0); cube.rotation.y = b * .25; group.add(cube); }
      } else if (theme.id === 'crystal-ocean') {
        for (let c = 0; c < 4; c += 1) { const crystal = new THREE.Mesh(new THREE.ConeGeometry(.35 + c * .05, 1.5 + c * .35, 5), c % 2 ? propMat : accentMat); crystal.position.set((c - 1.5) * .35, .75 + c * .16, Math.sin(c) * .3); crystal.rotation.z = (c - 1.5) * .13; group.add(crystal); }
      } else if (theme.id === 'dino-canyon') {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + index % 2 * .4, 0), propMat); rock.scale.y = 1.5; rock.position.y = .8; group.add(rock);
        const fossil = new THREE.Mesh(new THREE.TorusGeometry(.55, .12, 8, 24, Math.PI * 1.55), accentMat); fossil.position.set(.2, 1.2, .75); group.add(fossil);
      } else {
        const ice = new THREE.Mesh(new THREE.OctahedronGeometry(1 + index % 2 * .25, 0), index % 2 ? propMat : accentMat); ice.scale.set(.65, 1.8, .65); ice.position.y = 1.2; group.add(ice);
      }
      this.world.add(group);
    });
  }

  private sync(sim: Simulation): void {
    this.syncCollection(sim.players, this.playerMeshes, (entity) => this.createTank(entity.slot, sim.options.loadout));
    this.syncCollection(sim.enemies, this.enemyMeshes, (entity) => this.createEnemy(entity));
    this.syncCollection(sim.projectiles, this.bulletMeshes, (entity) => this.createBullet(entity));
    this.syncCollection(sim.pickups, this.pickupMeshes, (entity) => this.createPickup(entity));

    sim.players.forEach((player) => {
      const group = this.playerMeshes.get(player.id); if (!group) return;
      group.position.set(player.pos.x, player.alive ? 0 : -.25, player.pos.z);
      group.rotation.y = Math.atan2(player.aim.x, player.aim.z);
      group.visible = player.alive || player.downTimer > 0;
      group.userData.trackTime = (group.userData.trackTime ?? 0) + .12;
      const turret = group.userData.turret as THREE.Group | undefined;
      if (turret) turret.position.y = .64 + Math.sin(this.elapsed * 4 + player.slot) * .025;
      const companion = group.userData.companion as THREE.Group | undefined;
      if (companion) { companion.position.y = 1.25 + Math.sin(this.elapsed * 3.2 + player.slot) * .14; companion.rotation.y += .025; }
      const shield = group.userData.shield as THREE.Mesh | undefined;
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child !== shield) child.visible = player.invulnerable > 0 ? Math.sin(this.elapsed * 35) > -.15 : true;
      });
      if (shield) { shield.visible = player.shield > 0; shield.rotation.y += .025; }
    });

    sim.enemies.forEach((enemy) => {
      const group = this.enemyMeshes.get(enemy.id); if (!group) return;
      group.position.set(enemy.pos.x, .04 + Math.sin(enemy.phase * 3) * .05, enemy.pos.z);
      group.rotation.y = Math.atan2(enemy.vel.x, enemy.vel.z);
      group.rotation.z = Math.sin(enemy.phase * 2) * .03;
      const body = group.userData.body as THREE.Mesh | undefined;
      if (body) {
        const mat = body.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = enemy.hitFlash > 0 ? 4 : enemy.kind === 'boss' ? 1.5 : .8;
        mat.color.setHex(enemy.hitFlash > 0 ? 0xffffff : ENEMIES[enemy.kind].color);
      }
      const hpBar = group.userData.hp as THREE.Mesh | undefined;
      if (hpBar) hpBar.scale.x = Math.max(.001, enemy.hp / enemy.maxHp);
    });

    sim.projectiles.forEach((bullet) => {
      const mesh = this.bulletMeshes.get(bullet.id); if (!mesh) return;
      mesh.position.set(bullet.pos.x, bullet.team === 'player' ? .75 : .55, bullet.pos.z);
      mesh.rotation.y = Math.atan2(bullet.vel.x, bullet.vel.z);
    });
    sim.pickups.forEach((pickup) => {
      const group = this.pickupMeshes.get(pickup.id); if (!group) return;
      group.position.set(pickup.pos.x, .65 + Math.sin(this.elapsed * 3 + pickup.id) * .18, pickup.pos.z);
      group.rotation.y += .025;
    });
    if (this.safeZone) {
      this.safeZone.visible = sim.options.mode === 'last-core';
      this.safeZone.scale.setScalar(sim.safeRadius);
      (this.safeZone.material as THREE.MeshBasicMaterial).opacity = .5 + Math.sin(this.elapsed * 3) * .18;
    }
  }

  private syncCollection<T extends { id: number }, M extends THREE.Object3D>(items: readonly T[], map: Map<number, M>, create: (item: T) => M): void {
    const ids = new Set(items.map((item) => item.id));
    map.forEach((mesh, id) => { if (!ids.has(id)) { this.entityRoot.remove(mesh); map.delete(id); } });
    items.forEach((item) => {
      if (map.has(item.id)) return;
      const mesh = create(item); map.set(item.id, mesh); this.entityRoot.add(mesh);
    });
  }

  private createTank(slot: 1 | 2, loadout?: TankLoadout): THREE.Group {
    const group = new THREE.Group();
    group.scale.setScalar(1.22);
    const bodyColor = loadout ? PAINTS[loadout.paint].color : slot === 1 ? 0xffd84a : 0x6ff2ff;
    const bodyMat = material(bodyColor, bodyColor, loadout ? .38 : 1.15);
    const darkMat = material(0x101b29, slot === 1 ? 0xffd84a : 0x5eeaff, .28, .5);
    const cyan = material(0x9af8ff, 0x20dfff, loadout ? .62 : 1.8, .22);
    const body = roundedBox(1.35, .5, 1.75, .24, bodyMat); body.position.y = .46; group.add(body);
    this.addMovementModule(group, loadout?.movement ?? 'snow-tread', darkMat, cyan);
    if (loadout) {
      const sideRail = roundedBox(1.5, .16, .34, .07, darkMat); sideRail.position.set(0, .56, .52); group.add(sideRail);
      for (const x of [-.46, 0, .46]) { const panel = roundedBox(.34, .09, .42, .06, bodyMat); panel.position.set(x, .75, .28); panel.rotation.y = -.08 * x; group.add(panel); }
      for (const x of [-.46, .46]) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(.24, .12, .08), cyan); lamp.position.set(x, .58, -.89); group.add(lamp); }
      const rearCore = new THREE.Mesh(new THREE.BoxGeometry(.58, .22, .08), cyan); rearCore.position.set(0, .6, .9); group.add(rearCore);
    }
    const turret = new THREE.Group(); turret.position.y = .65;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(.48, .58, .32, 8), darkMat); dome.position.y = .22; dome.castShadow = true; turret.add(dome);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(.18, .18, 1.3), cyan); barrel.position.set(0, .27, -.65); turret.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(.3, .29, .25), bodyMat); muzzle.position.set(0, .27, -1.27); turret.add(muzzle);
    group.add(turret);
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.22, 20, 12),
      new THREE.MeshBasicMaterial({ color: slot === 1 ? 0x5ef3ff : 0xffee87, wireframe: true, transparent: true, opacity: .25, blending: THREE.AdditiveBlending }),
    );
    shield.position.y = .55; shield.visible = false; group.add(shield);
    const marker = new THREE.Mesh(new THREE.RingGeometry(.86, .94, 32), new THREE.MeshBasicMaterial({ color: slot === 1 ? 0xffd84a : 0x54edff, transparent: true, opacity: .65, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.position.y = .02; group.add(marker);
    const companion = new THREE.Group(); companion.position.set(slot === 1 ? 1.15 : -1.15, 1.25, .4);
    const buddyCore = new THREE.Mesh(new THREE.OctahedronGeometry(.18, 0), cyan); companion.add(buddyCore);
    const buddyRing = new THREE.Mesh(new THREE.TorusGeometry(.27, .025, 5, 20), new THREE.MeshBasicMaterial({ color: slot === 1 ? 0xffd84a : 0x54edff })); buddyRing.rotation.x = Math.PI / 2; companion.add(buddyRing); group.add(companion);
    group.userData.turret = turret; group.userData.shield = shield; group.userData.companion = companion;
    return group;
  }

  private addMovementModule(group: THREE.Group, id: MovementModuleId, darkMat: THREE.Material, glowMat: THREE.Material): void {
    const wheelMat = material(MOVEMENT_MODULES[id].color, MOVEMENT_MODULES[id].color, id === 'amphibious' ? .72 : .24, .44);
    if (id === 'snow-tread') {
      for (const x of [-.78, .78]) {
        const track = roundedBox(.34, .44, 1.95, .14, darkMat); track.position.set(x, .3, 0); group.add(track);
        for (let z = -.62; z <= .62; z += .4) { const cleat = new THREE.Mesh(new THREE.BoxGeometry(.09, .13, .22), glowMat); cleat.position.set(x * 1.02, .28, z); group.add(cleat); }
      }
      return;
    }
    const zPositions = id === 'road-wheel' ? [-.62, .62] : [-.7, 0, .7];
    for (const x of [-.77, .77]) {
      zPositions.forEach((z) => {
        const radius = id === 'sand-float' ? .39 : id === 'amphibious' ? .36 : .33;
        const width = id === 'sand-float' ? .3 : .23;
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, id === 'all-terrain' ? 10 : 20), darkMat);
        wheel.rotation.z = Math.PI / 2; wheel.position.set(x, .31, z); wheel.castShadow = true; group.add(wheel);
        const hub = new THREE.Mesh(new THREE.TorusGeometry(radius * .62, id === 'amphibious' ? .075 : .04, 8, 24), wheelMat);
        hub.rotation.y = Math.PI / 2; hub.position.set(x + Math.sign(x) * (width / 2 + .01), .31, z); group.add(hub);
        if (id === 'amphibious') {
          const outer = new THREE.Mesh(new THREE.TorusGeometry(radius * .88, .045, 7, 24), darkMat); outer.rotation.y = Math.PI / 2; outer.position.copy(hub.position); group.add(outer);
          for (let n = 0; n < 10; n += 1) { const lug = new THREE.Mesh(new THREE.BoxGeometry(.06, .055, .11), darkMat); const a = n / 10 * Math.PI * 2; lug.position.set(hub.position.x, .31 + Math.sin(a) * radius, z + Math.cos(a) * radius); lug.rotation.x = a; group.add(lug); }
        }
        if (id === 'all-terrain') {
          for (let n = 0; n < 8; n += 1) { const lug = new THREE.Mesh(new THREE.BoxGeometry(.08, .07, .12), wheelMat); const a = n / 8 * Math.PI * 2; lug.position.set(x, .31 + Math.sin(a) * (radius + .02), z + Math.cos(a) * (radius + .02)); lug.rotation.x = a; group.add(lug); }
        }
      });
    }
    if (id === 'amphibious') {
      const underGlow = new THREE.Mesh(new THREE.RingGeometry(.78, 1.18, 40), new THREE.MeshBasicMaterial({ color: 0x35e8ff, transparent: true, opacity: .32, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      underGlow.rotation.x = -Math.PI / 2; underGlow.position.y = .08; group.add(underGlow);
    }
  }

  private createEnemy(enemy: EnemyEntity): THREE.Group {
    const def = ENEMIES[enemy.kind];
    const group = new THREE.Group();
    const bodyMat = material(def.color, def.color, enemy.kind === 'boss' ? 1.45 : .85);
    const darkMat = material(0x121321, def.color, .22, .52);
    let body: THREE.Mesh;
    if (enemy.kind === 'charger') body = new THREE.Mesh(new THREE.ConeGeometry(.55, 1.35, 5), bodyMat);
    else if (enemy.kind === 'bulwark') body = roundedBox(1.55, .75, 1.55, .18, bodyMat);
    else if (enemy.kind === 'splitter') body = new THREE.Mesh(new THREE.OctahedronGeometry(.9, 0), bodyMat);
    else if (enemy.kind === 'medic') body = new THREE.Mesh(new THREE.TorusKnotGeometry(.4, .16, 48, 8), bodyMat);
    else if (enemy.kind === 'sniper') body = new THREE.Mesh(new THREE.ConeGeometry(.7, 1.4, 3), bodyMat);
    else if (enemy.kind === 'boss') body = new THREE.Mesh(new THREE.DodecahedronGeometry(1.65, 1), bodyMat);
    else body = new THREE.Mesh(new THREE.CylinderGeometry(.55, .7, .65, enemy.kind === 'gunner' ? 6 : 10), bodyMat);
    body.position.y = enemy.kind === 'boss' ? 1.55 : .62;
    if (enemy.kind === 'charger' || enemy.kind === 'sniper') body.rotation.x = Math.PI / 2;
    body.castShadow = true; group.add(body);
    const core = new THREE.Mesh(new THREE.SphereGeometry(enemy.kind === 'boss' ? .48 : .23, 12, 8), material(0xffffff, def.color, 2.2, .15));
    core.position.set(0, enemy.kind === 'boss' ? 1.55 : .7, -.5); group.add(core);
    if (enemy.kind === 'boss') {
      for (let i = 0; i < 6; i += 1) { const spike = new THREE.Mesh(new THREE.ConeGeometry(.18, .9, 5), darkMat); spike.position.set(Math.cos(i * Math.PI / 3) * 1.7, 1.55, Math.sin(i * Math.PI / 3) * 1.7); spike.rotation.z = Math.PI / 2; spike.rotation.y = -i * Math.PI / 3; group.add(spike); }
    }
    const hpBack = new THREE.Mesh(new THREE.PlaneGeometry(enemy.kind === 'boss' ? 3 : 1.3, .11), new THREE.MeshBasicMaterial({ color: 0x1a1f2b, side: THREE.DoubleSide }));
    hpBack.position.set(0, enemy.kind === 'boss' ? 3.25 : 1.55, 0); hpBack.rotation.x = -Math.PI / 4; group.add(hpBack);
    const hp = new THREE.Mesh(new THREE.PlaneGeometry(enemy.kind === 'boss' ? 2.9 : 1.2, .065), new THREE.MeshBasicMaterial({ color: enemy.kind === 'boss' ? 0xffd34a : 0x75ffad, side: THREE.DoubleSide }));
    hp.position.set(0, enemy.kind === 'boss' ? 3.24 : 1.54, -.02); hp.rotation.x = -Math.PI / 4; group.add(hp);
    group.userData.body = body; group.userData.hp = hp;
    return group;
  }

  private createBullet(bullet: ProjectileEntity): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(bullet.radius, bullet.team === 'player' ? .5 : .28, 4, 6),
      new THREE.MeshBasicMaterial({ color: bullet.color, transparent: true, opacity: .96, blending: THREE.AdditiveBlending }),
    );
    mesh.rotation.x = Math.PI / 2; return mesh;
  }

  private createPickup(pickup: PickupEntity): THREE.Group {
    const colors: Record<PickupEntity['kind'], number> = { shield: 0x56efff, rapid: 0xffd84a, multi: 0xff6fd2, power: 0xb7ff6c, stars: 0xffffff };
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(.42, 0), material(colors[pickup.kind], colors[pickup.kind], 2)); group.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.65, .05, 6, 28), new THREE.MeshBasicMaterial({ color: colors[pickup.kind] })); ring.rotation.x = Math.PI / 2; group.add(ring);
    return group;
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i]; if (!particle) continue;
      particle.life -= dt;
      particle.velocity.y -= 8 * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.rotation.x += particle.spin.x * dt; particle.mesh.rotation.y += particle.spin.y * dt;
      const scale = Math.max(.01, particle.life / particle.maxLife);
      particle.mesh.scale.setScalar(scale);
      if (particle.life <= 0) { this.effectRoot.remove(particle.mesh); particle.mesh.geometry.dispose(); this.particles.splice(i, 1); }
    }
  }

  private updateReplay(): void {
    if (!this.replayFrames.length || !this.replayGhosts.length) return;
    const duration = this.replayFrames[this.replayFrames.length - 1]?.t ?? 0;
    const time = ((performance.now() - this.replayStart) / 1000) % Math.max(.1, duration);
    let index = this.replayFrames.findIndex((frame) => frame.t >= time);
    if (index < 0) index = this.replayFrames.length - 1;
    const frame = this.replayFrames[index]; if (!frame) return;
    const p1 = this.replayGhosts[0]; const p2 = this.replayGhosts[1];
    if (p1) { p1.position.set(frame.p1x, 0, frame.p1z); p1.rotation.y = frame.p1r; }
    if (p2 && frame.p2x !== undefined && frame.p2z !== undefined) p2.position.set(frame.p2x, 0, frame.p2z);
  }

  private onWorkshopPointerDown = (event: PointerEvent): void => {
    if (this.viewMode !== 'workshop') return;
    this.workshopDragging = true; this.workshopPointerX = event.clientX;
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private onWorkshopPointerMove = (event: PointerEvent): void => {
    if (!this.workshopDragging || this.viewMode !== 'workshop') return;
    const dx = event.clientX - this.workshopPointerX; this.workshopPointerX = event.clientX;
    this.workshopAngle -= dx * .006;
  };

  private onWorkshopPointerUp = (): void => { this.workshopDragging = false; };

  private onWorkshopWheel = (event: WheelEvent): void => {
    if (this.viewMode !== 'workshop') return;
    event.preventDefault(); this.workshopRadius = THREE.MathUtils.clamp(this.workshopRadius + event.deltaY * .008, 7.8, 13.5);
  };

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.camera.aspect = width / height;
    const compact = width / height < .78;
    this.camera.fov = compact ? 56 : 44;
    if (this.viewMode !== 'workshop') this.camera.position.z = compact ? 21 : 18.5;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  }

  private clearEntities(): void {
    this.playerMeshes.clear(); this.enemyMeshes.clear(); this.bulletMeshes.clear(); this.pickupMeshes.clear();
    while (this.entityRoot.children.length) this.entityRoot.remove(this.entityRoot.children[0]!);
  }
}
