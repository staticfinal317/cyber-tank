import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ENEMIES } from '../content/enemies';
import { THEMES } from '../content/themes';
import { MOVEMENT_MODULES, PAINTS, SEASONS } from '../content/expedition';
import type { CompanionId, MovementModuleId, SeasonId, TankLoadout, ThemeDefinition, Vec2 } from '../core/types';
import type { EnemyEntity, PickupEntity, PlayerEntity, ProjectileEntity, Simulation, TacticalNode } from '../gameplay/Simulation';
import type { RenderQuality } from '../platform/PerformanceGovernor';
import { ModelAssetLibrary, type ModelAssetSpec, type ModelSlot } from './ModelAssetLibrary';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: THREE.Vector3;
}

interface TrailMark { mesh: THREE.Mesh; life: number; maxLife: number; expanding: boolean }

function material(color: number, emissive = color, intensity = .65, roughness = .32): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color, emissive, emissiveIntensity: intensity, roughness, metalness: .72,
    clearcoat: .42, clearcoatRoughness: .24, sheen: .08, sheenColor: new THREE.Color(color), envMapIntensity: 1.15,
  });
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
  private readonly tacticalNodeMeshes = new Map<TacticalNode['id'], THREE.Group>();
  private readonly particles: Particle[] = [];
  private readonly trailMarks: TrailMark[] = [];
  private readonly lastTrailPositions = new Map<number, Vec2>();
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
  private workshopProp?: THREE.Group;
  private workshopGeneration = 0;
  private assetRequestSerial = 0;
  private workshopAngle = -.5;
  private workshopRadius = 10.5;
  private workshopDragging = false;
  private workshopPointerX = 0;
  private expeditionSeason?: SeasonId;
  private weatherParticles: THREE.Mesh[] = [];
  private quality: RenderQuality = 'balanced';
  private particleBudget = 160;
  private readonly modelAssets = new ModelAssetLibrary();
  private readonly bulletGeometry = {
    player: new THREE.CapsuleGeometry(.15, .5, 4, 6),
    enemy: new THREE.CapsuleGeometry(.18, .28, 4, 6),
  };
  private readonly bulletMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private reduceFlashes = false;
  private contextListener?: (state: 'lost' | 'restored') => void;
  private teamMarkerMesh?: THREE.Mesh;
  private readonly animatedWorld: THREE.Object3D[] = [];
  private worldGeneration = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private theme: ThemeDefinition) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .74;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, .04).texture;
    room.dispose(); pmrem.dispose();
    this.camera.position.set(0, 14.8, 21.4);
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
    this.teamMarkerMesh = new THREE.Mesh(new THREE.RingGeometry(.72, .94, 40), new THREE.MeshBasicMaterial({ color: 0x55efff, transparent: true, opacity: .82, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.teamMarkerMesh.rotation.x = -Math.PI / 2; this.teamMarkerMesh.visible = false; this.effectRoot.add(this.teamMarkerMesh);
    this.buildWorld(theme);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    canvas.addEventListener('pointerdown', this.onWorkshopPointerDown);
    canvas.addEventListener('pointermove', this.onWorkshopPointerMove);
    window.addEventListener('pointerup', this.onWorkshopPointerUp);
    canvas.addEventListener('wheel', this.onWorkshopWheel, { passive: false });
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    this.resize();
    void this.modelAssets.loadCatalog();
  }

  registerModelAsset(slot: ModelSlot, spec: ModelAssetSpec): void { this.modelAssets.register(slot, spec); }
  setContextListener(listener: (state: 'lost' | 'restored') => void): void { this.contextListener = listener; }
  setAccessibility(settings: { reduceFlashes: boolean }): void {
    this.reduceFlashes = settings.reduceFlashes;
    if (this.reduceFlashes) this.shakePower = 0;
    this.applyQualityVisuals();
  }

  setSimulation(simulation: Simulation): void {
    this.viewMode = 'arena';
    this.simulation = simulation;
    this.stopReplay();
    this.clearEntities();
  }

  setQuality(quality: RenderQuality): void {
    const changed = quality !== this.quality;
    this.quality = quality;
    this.modelAssets.setQuality(quality);
    this.particleBudget = quality === 'high' ? 280 : quality === 'balanced' ? 160 : 80;
    // Software WebGL used by browser automation needs a smaller internal
    // framebuffer. Real devices keep the quality-specific native ratio.
    const ratio = navigator.webdriver
      ? Math.min(window.devicePixelRatio, .65)
      : Math.min(window.devicePixelRatio, quality === 'high' ? 1.8 : quality === 'balanced' ? 1.35 : 1);
    this.renderer.setPixelRatio(ratio); this.composer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = quality !== 'battery';
    this.applyQualityVisuals(); this.resize();
    if (changed) this.refreshExternalModels();
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
    this.replayGhosts.forEach((ghost) => removeAndDispose(this.entityRoot, ghost));
    this.replayGhosts = []; this.replayFrames = [];
  }

  setTheme(id: ThemeDefinition['id']): void {
    this.invalidateWorkshopRequests();
    this.viewMode = 'arena';
    this.expeditionSeason = undefined;
    this.renderer.toneMappingExposure = .74; this.bloom.threshold = .72; this.bloom.strength = .44; this.bloom.radius = .38;
    this.theme = THEMES[id];
    clearAndDispose(this.world);
    this.buildWorld(this.theme);
    this.applyQualityVisuals();
  }

  setExpeditionSeason(season: SeasonId): void {
    this.invalidateWorkshopRequests();
    this.viewMode = 'arena';
    this.expeditionSeason = season;
    this.renderer.toneMappingExposure = season === 'winter' ? .7 : .66;
    this.bloom.threshold = .68; this.bloom.strength = season === 'summer' ? .58 : .52; this.bloom.radius = .42;
    clearAndDispose(this.world);
    this.buildExpeditionWorld(season);
    this.applyQualityVisuals();
  }

  showWorkshop(loadout: TankLoadout, season: SeasonId = 'spring'): void {
    this.invalidateWorkshopRequests();
    this.simulation = undefined;
    this.stopReplay();
    this.clearEntities();
    this.viewMode = 'workshop';
    this.renderer.toneMappingExposure = .52; this.bloom.threshold = .9; this.bloom.strength = .18; this.bloom.radius = .22;
    clearAndDispose(this.world);
    this.expeditionSeason = season;
    this.buildWorkshop(loadout, season);
    this.applyQualityVisuals();
  }

  updateWorkshopLoadout(loadout: TankLoadout): void {
    if (this.viewMode !== 'workshop') return;
    if (this.workshopTank) removeAndDispose(this.entityRoot, this.workshopTank);
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
    this.updateTrailMarks(dt);
    const shake = this.reduceFlashes ? 0 : this.shakePower;
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
      this.camera.position.set(this.cameraTarget.x * .28 + x, 14.8 + y, 21.4 + this.cameraTarget.z * .18 + y);
      this.camera.lookAt(this.cameraTarget.x + x * .25, .26, this.cameraTarget.z - 1.15 + y * .2);
    }
    this.updateWeatherParticles(dt);
    this.animateWorld(dt);
    this.world.rotation.y = Math.sin(this.elapsed * .09) * .002;
    // Battery mode intentionally skips the multi-pass bloom/chromatic pipeline.
    // Besides saving fill-rate on entry-level tablets, this keeps software WebGL
    // responsive enough for full interaction tests instead of merely hiding them.
    if (this.quality === 'battery') this.renderer.render(this.scene, this.camera);
    else this.composer.render();
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
    const desired = this.reduceFlashes ? (heavy ? 5 : 2) : heavy ? (this.quality === 'battery' ? 16 : 32) : (this.quality === 'battery' ? 6 : 10);
    const count = Math.max(0, Math.min(desired, this.particleBudget - this.particles.length));
    for (let i = 0; i < count; i += 1) {
      const isDebris = i % 3 === 0;
      const geometry = isDebris ? new THREE.BoxGeometry(.12, .1, .2) : new THREE.SphereGeometry(.07, 5, 4);
      const mesh = new THREE.Mesh(geometry, material(i % 4 === 0 ? 0xffd65a : color, color, this.reduceFlashes ? .55 : 2.2));
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
    this.shakePower = Math.max(this.shakePower, this.reduceFlashes ? 0 : heavy ? .75 : .16);
    if (this.reduceFlashes) return;
    const flash = new THREE.PointLight(color, heavy ? 12 : 5, heavy ? 10 : 4, 2);
    flash.position.set(pos.x, 1.3, pos.z); this.effectRoot.add(flash);
    window.setTimeout(() => this.effectRoot.remove(flash), heavy ? 130 : 70);
  }

  muzzle(player: PlayerEntity, projectile: ProjectileEntity): void {
    if (this.reduceFlashes) return;
    const color = projectile.color;
    const dir = new THREE.Vector3(projectile.vel.x, 0, projectile.vel.z).normalize();
    const pos = projectile.pos;
    const flash = new THREE.PointLight(color, 7, 5.2, 2);
    flash.position.set(pos.x, .92, pos.z); this.effectRoot.add(flash);
    window.setTimeout(() => this.effectRoot.remove(flash), 45);
    const flare = new THREE.Mesh(
      new THREE.ConeGeometry(.22, .72, 9, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .92, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flare.rotation.x = Math.PI / 2;
    flare.rotation.y = Math.atan2(dir.x, dir.z);
    flare.position.set(pos.x + dir.x * .18, .83, pos.z + dir.z * .18);
    this.effectRoot.add(flare);
    const maxLife = .11;
    this.particles.push({ mesh: flare, velocity: dir.multiplyScalar(1.5), life: maxLife, maxLife, spin: new THREE.Vector3(0, 0, 9) });
    const tank = this.playerMeshes.get(player.id);
    if (tank) tank.userData.recoil = Math.max(tank.userData.recoil ?? 0, .28);
    this.shakePower = Math.max(this.shakePower, .055);
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
      if (t >= 1) { removeAndDispose(this.effectRoot, ring); return; }
      ring.scale.setScalar(1 + t * 9); (ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      requestAnimationFrame(animate);
    };
    animate();
  }

  private buildWorld(theme: ThemeDefinition): void {
    this.worldGeneration += 1;
    this.weatherParticles = [];
    this.animatedWorld.length = 0;
    this.tacticalNodeMeshes.clear();
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
    this.addTacticalBattlefield(theme.primary, theme.accent, theme.danger, false);

    this.safeZone = new THREE.Mesh(
      new THREE.RingGeometry(.985, 1, 96),
      new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: .7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.safeZone.rotation.x = -Math.PI / 2; this.safeZone.position.y = .035; this.safeZone.visible = false;
    this.world.add(this.safeZone);
  }

  private buildExpeditionWorld(season: SeasonId): void {
    const generation = ++this.worldGeneration;
    const palette = this.seasonPalette(season);
    this.weatherParticles = [];
    this.animatedWorld.length = 0;
    this.tacticalNodeMeshes.clear();
    const battleSky = new THREE.Color(palette.sky).multiplyScalar(season === 'winter' ? .5 : .26);
    const battleFog = new THREE.Color(palette.fog).multiplyScalar(season === 'winter' ? .58 : .34);
    this.scene.background = battleSky;
    this.scene.fog = new THREE.FogExp2(battleFog, season === 'summer' ? .016 : .012);

    const hemi = new THREE.HemisphereLight(palette.hemi, battleFog, season === 'winter' ? 1.18 : .92);
    const sun = new THREE.DirectionalLight(palette.sun, season === 'summer' ? 1.72 : season === 'winter' ? 1.55 : 1.62);
    sun.position.set(-8, 18, 10); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18; sun.shadow.camera.right = 18; sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
    const seasonalGlow = new THREE.PointLight(SEASONS[season].accent, 15, 30, 2); seasonalGlow.position.set(0, 4.5, -5.5);
    this.world.add(hemi, sun, seasonalGlow);

    const groundColor = new THREE.Color(palette.ground).multiplyScalar(season === 'winter' ? .72 : .42);
    const highlandColor = new THREE.Color(palette.highland).multiplyScalar(season === 'winter' ? .76 : .46);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(34, 30), new THREE.MeshStandardMaterial({ color: groundColor, roughness: .86, metalness: .04 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.12; ground.receiveShadow = true; ground.userData.expeditionGround = true; this.world.add(ground);
    const highland = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 23), new THREE.MeshStandardMaterial({
      color: highlandColor, roughness: .94, transparent: true, opacity: .48,
    }));
    highland.rotation.x = -Math.PI / 2; highland.position.set(-7.9, -.08, 0); highland.receiveShadow = true; highland.userData.naturalOverlay = true; this.world.add(highland);
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 20), new THREE.MeshStandardMaterial({
      color: season === 'winter' ? 0x829ba7 : 0x59432d, roughness: .95, transparent: true, opacity: .42,
    }));
    beach.rotation.x = -Math.PI / 2; beach.position.set(10.2, -.07, -.5); beach.userData.naturalOverlay = true; this.world.add(beach);
    const riverMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(palette.water).multiplyScalar(.72), emissive: palette.water, emissiveIntensity: .24, roughness: season === 'winter' ? .08 : .18,
      metalness: season === 'winter' ? .52 : .06, transmission: season === 'winter' ? .22 : .12, transparent: true, opacity: .9,
    });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(4.25, 24, 8, 28), riverMat); river.rotation.x = -Math.PI / 2; river.position.set(0, -.035, -1); river.receiveShadow = true; river.userData.river = true; river.userData.waterFlow = true; this.world.add(river); this.animatedWorld.push(river);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 23), new THREE.MeshStandardMaterial({ color: season === 'winter' ? 0x80939c : 0x44545a, roughness: .78, metalness: .15 }));
    road.rotation.x = -Math.PI / 2; road.position.set(4.6, -.015, .4); road.rotation.z = -.05; this.world.add(road);
    for (let z = -9; z <= 9; z += 2) {
      const marker = new THREE.Mesh(new THREE.PlaneGeometry(.11, .8), new THREE.MeshBasicMaterial({ color: 0xffe681, transparent: true, opacity: .65 }));
      marker.rotation.x = -Math.PI / 2; marker.position.set(4.6 + z * .012, .005, z); this.world.add(marker);
    }

    const rockMat = material(palette.mountain, palette.mountainGlow, .05, .92);
    for (let i = 0; i < 13; i += 1) {
      const h = 1.8 + (i % 4) * .65;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(1.25 + (i % 3) * .3, h, 7), rockMat);
      mountain.position.set(-13.2 + i * 2.15, h / 2 - .15, -15.2 - (i % 2) * .55); mountain.rotation.y = i * .53; mountain.castShadow = true; mountain.userData.proceduralVista = true; this.world.add(mountain);
    }
    const trunkMat = material(0x543b28, 0x1c120d, .02, .95); const leafMat = material(palette.leaf, palette.leafGlow, .12, .82);
    for (let i = 0; i < 18; i += 1) {
      const tree = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.07, .12, .72, 7), trunkMat); trunk.position.y = .36; tree.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.38 + (i % 3) * .08, 1), leafMat); crown.position.y = .88; crown.scale.set(1.25, .95, 1); tree.add(crown);
      tree.position.set(i % 2 ? -10.8 + (i % 5) * 1.4 : 7.3 + (i % 4) * 1.45, .02, -8.6 + Math.floor(i / 5) * 4.4); tree.rotation.y = i * .7;
      tree.scale.setScalar(.78); tree.userData.proceduralFoliage = true; this.world.add(tree);
    }
    for (let i = 0; i < 20; i += 1) {
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(.18 + (i % 3) * .09, 0), rockMat); stone.scale.y = .55;
      stone.position.set((i % 2 ? -1 : 1) * (2.25 + (i % 3) * .16), .12, -9 + i * .95); stone.rotation.y = i; this.world.add(stone);
    }

    const routeMat = new THREE.MeshBasicMaterial({ color: SEASONS[season].accent, transparent: true, opacity: .76, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 11; i += 1) {
      const beacon = new THREE.Mesh(new THREE.RingGeometry(.18, .26, 20), routeMat); beacon.rotation.x = -Math.PI / 2;
      const riverRoute = i % 2 === 0; beacon.position.set(riverRoute ? 0 : -7.2, .035, 8.5 - i * 1.75); beacon.userData.routeBeacon = true; this.world.add(beacon);
    }
    const routePaths = [
      { color: palette.water, points: [[0, .045, 10], [-.5, .05, 5], [.45, .05, 0], [-.35, .05, -5], [0, .05, -10]] },
      { color: SEASONS[season].accent, points: [[-7.2, .05, 10], [-8.1, .08, 5], [-6.5, .06, 1], [-8.3, .1, -4], [-6.9, .06, -10]] },
    ] as const;
    routePaths.forEach((route, index) => {
      const curve = new THREE.CatmullRomCurve3(route.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const spline = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, .045, 7, false), new THREE.MeshBasicMaterial({ color: route.color, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthWrite: false }));
      spline.userData.routeBeacon = true; spline.userData.routeIndex = index; this.world.add(spline);
    });
    for (let i = 0; i < 7; i += 1) {
      const cloud = new THREE.Group();
      for (let puff = 0; puff < 4; puff += 1) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(.7 + puff * .08, 10, 7), new THREE.MeshBasicMaterial({ color: palette.sky, transparent: true, opacity: .18, depthWrite: false, fog: false }));
        mesh.position.set(puff * .65, Math.sin(puff) * .18, 0); mesh.scale.y = .48; cloud.add(mesh);
      }
      cloud.position.set(-13 + i * 4.5, 5.8 + (i % 3) * .7, -13.2 - (i % 2)); cloud.userData.distantCloud = true; this.world.add(cloud);
    }
    this.addTacticalBattlefield(palette.water, SEASONS[season].accent, palette.blossom, true);
    this.addMountainSeaCitadel(palette, season);

    this.safeZone = new THREE.Mesh(new THREE.RingGeometry(.985, 1, 96), new THREE.MeshBasicMaterial({ color: SEASONS[season].accent, transparent: true, opacity: .65, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.safeZone.rotation.x = -Math.PI / 2; this.safeZone.position.y = .04; this.safeZone.visible = false; this.world.add(this.safeZone);

    const weatherGeometry = season === 'spring' || season === 'summer' ? new THREE.BoxGeometry(.018, .55, .018) : new THREE.SphereGeometry(.035, 5, 4);
    const weatherMaterial = new THREE.MeshBasicMaterial({ color: palette.particle, transparent: true, opacity: season === 'summer' ? .45 : .75, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 90; i += 1) {
      const particle = new THREE.Mesh(weatherGeometry, weatherMaterial); particle.position.set(-14 + Math.random() * 28, .5 + Math.random() * 10, -12 + Math.random() * 24);
      particle.scale.set(season === 'autumn' ? 2 : 1, season === 'winter' ? 1 : 1, season === 'autumn' ? .4 : 1); particle.userData.weather = true; particle.userData.seed = Math.random() * 10;
      this.world.add(particle); this.weatherParticles.push(particle);
    }
    void this.attachExpeditionArt(generation);
  }

  private async attachExpeditionArt(generation: number): Promise<void> {
    const loader = new THREE.TextureLoader();
    const base = import.meta.env.BASE_URL;
    const [backdrop, floor] = await Promise.all([
      loader.loadAsync(`${base}assets/environment/mountain-sea-citadel.jpg`),
      loader.loadAsync(`${base}assets/environment/neon-tactical-floor.jpg`),
    ]);
    if (generation !== this.worldGeneration || this.viewMode !== 'arena' || !this.expeditionSeason) {
      backdrop.dispose(); floor.dispose(); return;
    }
    backdrop.colorSpace = THREE.SRGBColorSpace;
    backdrop.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const backdropMaterial = new THREE.MeshBasicMaterial({
      map: backdrop, transparent: true, opacity: 0, fog: false, depthWrite: false,
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(72, 40.5), backdropMaterial);
    plate.position.set(0, -8, -24); plate.renderOrder = -10; plate.userData.backdropFade = true;
    this.world.add(plate); this.animatedWorld.push(plate);

    floor.colorSpace = THREE.SRGBColorSpace;
    floor.wrapS = THREE.RepeatWrapping; floor.wrapT = THREE.RepeatWrapping;
    floor.repeat.set(.82, 4.2);
    floor.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const arenaFloor = floor.clone();
    arenaFloor.wrapS = THREE.RepeatWrapping; arenaFloor.wrapT = THREE.RepeatWrapping;
    arenaFloor.repeat.set(1.14, 1.02);
    arenaFloor.anisotropy = floor.anisotropy;
    arenaFloor.needsUpdate = true;
    this.world.traverse((object) => {
      if (object.userData.proceduralVista) {
        object.userData.forceHidden = true; object.visible = false;
      }
      if (object.userData.proceduralFoliage) {
        object.userData.forceHidden = true; object.visible = false;
      }
      if (object.userData.expeditionGround && object instanceof THREE.Mesh) {
        const groundMaterial = object.material as THREE.MeshStandardMaterial;
        groundMaterial.map = arenaFloor;
        groundMaterial.color.setHex(0x93a7b3);
        groundMaterial.roughness = .68;
        groundMaterial.metalness = .3;
        groundMaterial.needsUpdate = true;
      }
      if (object.userData.naturalOverlay && object instanceof THREE.Mesh) {
        const overlayMaterial = object.material as THREE.MeshStandardMaterial;
        overlayMaterial.color.multiplyScalar(.62);
        overlayMaterial.opacity = .34;
        overlayMaterial.needsUpdate = true;
      }
      if (!object.userData.tacticalFloor || !(object instanceof THREE.Mesh)) return;
      const laneMaterial = object.material as THREE.MeshStandardMaterial;
      laneMaterial.map = floor;
      laneMaterial.color.setHex(0xdce7ee);
      laneMaterial.roughness = .54;
      laneMaterial.metalness = .42;
      laneMaterial.transparent = false;
      laneMaterial.opacity = 1;
      laneMaterial.needsUpdate = true;
    });
  }

  private addTacticalBattlefield(primary: number, accent: number, danger: number, natural: boolean): void {
    const deckMat = material(natural ? 0x172a2d : 0x111a28, primary, .16, .48);
    const edgeMat = material(0x152330, primary, .82, .28);
    const coverMat = material(natural ? 0x182a31 : 0x1c2735, accent, .22, .48);
    const warningMat = material(0x28231a, 0xffb928, .72, .35);

    // Three readable lanes, inspired by objective-based arena maps, remain
    // wide enough for tablet controls and young players.
    const laneDefinitions = [
      { x: -7.1, z: .3, w: 3.1, d: 17.8, color: primary },
      { x: 0, z: -.8, w: 3.25, d: 19.6, color: accent },
      { x: 7.1, z: .3, w: 3.1, d: 17.8, color: danger },
    ];
    laneDefinitions.forEach((lane, index) => {
      const laneDeck = new THREE.Mesh(new THREE.PlaneGeometry(lane.w, lane.d), new THREE.MeshStandardMaterial({
        color: natural ? 0x263b3a : 0x121d29, emissive: lane.color, emissiveIntensity: .045,
        roughness: natural ? .84 : .5, metalness: natural ? .08 : .42, transparent: true, opacity: natural ? .42 : .78,
      }));
      laneDeck.rotation.x = -Math.PI / 2; laneDeck.position.set(lane.x, -.018 + index * .002, lane.z); laneDeck.receiveShadow = true; laneDeck.userData.tacticalFloor = true; this.world.add(laneDeck);
      for (let z = -7.5; z <= 7.5; z += 2.5) {
        const chevron = new THREE.Mesh(new THREE.BoxGeometry(.56, .025, .07), new THREE.MeshBasicMaterial({ color: lane.color, transparent: true, opacity: .56, blending: THREE.AdditiveBlending }));
        chevron.position.set(lane.x, .018, z); chevron.rotation.y = index === 1 ? 0 : index === 0 ? -.18 : .18; chevron.userData.balancedDetail = true; this.world.add(chevron);
      }
    });

    const bridges = [
      { x: -3.45, z: -2.4, w: 3.25, d: 1.22, rot: 0 },
      { x: 3.45, z: -2.4, w: 3.25, d: 1.22, rot: 0 },
      { x: 0, z: 3.2, w: 3.45, d: 1.12, rot: Math.PI / 2 },
    ];
    bridges.forEach((bridge, index) => {
      const deck = roundedBox(bridge.w, .18, bridge.d, .12, deckMat); deck.position.set(bridge.x, .09, bridge.z); deck.rotation.y = bridge.rot; this.world.add(deck);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(bridge.w * .9, .1, .06), index === 2 ? warningMat : edgeMat);
        rail.position.set(bridge.x, .28, bridge.z + side * bridge.d * .38); rail.rotation.y = bridge.rot; this.world.add(rail);
      }
    });

    const coverPositions = [
      [-4.8, 5.0, 1.5, .64, .28], [4.8, 5.0, 1.5, .64, -.28],
      [-8.9, 2.0, 1.4, .68, -.18], [8.9, 2.0, 1.4, .68, .18],
      [-4.7, -5.3, 1.55, .68, -.18], [4.7, -5.3, 1.55, .68, .18],
      [-9.2, -5.8, 1.2, .62, .35], [9.2, -5.8, 1.2, .62, -.35],
    ] as const;
    coverPositions.forEach(([x, z, w, d, rot], index) => {
      const root = new THREE.Group(); root.position.set(x, 0, z); root.rotation.y = rot;
      const base = roundedBox(w, .72 + index % 2 * .16, d, .12, index % 3 === 0 ? warningMat : coverMat); base.position.y = .36; root.add(base);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * .72, .08, d + .025), new THREE.MeshBasicMaterial({ color: index % 2 ? accent : primary, transparent: true, opacity: .82, blending: THREE.AdditiveBlending }));
      strip.position.y = .62; root.add(strip);
      root.userData.balancedDetail = true; this.world.add(root);
    });

    const nodeSpecs: Array<{ id: TacticalNode['id']; pos: Vec2; color: number; label: string }> = [
      { id: 'a', pos: { x: -7.1, z: -.8 }, color: 0x35e8ff, label: 'A' },
      { id: 'core', pos: { x: 0, z: -2.4 }, color: 0xffd84a, label: 'CORE' },
      { id: 'b', pos: { x: 7.1, z: -.8 }, color: 0xff5ecb, label: 'B' },
    ];
    nodeSpecs.forEach((spec) => {
      const root = new THREE.Group(); root.position.set(spec.pos.x, 0, spec.pos.z);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(spec.id === 'core' ? 1.3 : 1.08, spec.id === 'core' ? 1.42 : 1.18, .18, 36), deckMat);
      pad.position.y = .08; pad.receiveShadow = true; root.add(pad);
      const outer = new THREE.Mesh(new THREE.TorusGeometry(spec.id === 'core' ? 1.18 : .96, .055, 8, 48), new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: .78, blending: THREE.AdditiveBlending, depthWrite: false }));
      outer.rotation.x = Math.PI / 2; outer.position.y = .22; outer.userData.spinSpeed = spec.id === 'core' ? -.72 : .54; root.add(outer); this.animatedWorld.push(outer);
      const progress = new THREE.Mesh(new THREE.TorusGeometry(spec.id === 'core' ? .9 : .72, .09, 8, 48), new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: .86, blending: THREE.AdditiveBlending, depthWrite: false }));
      progress.rotation.x = Math.PI / 2; progress.position.y = .25; progress.scale.setScalar(.05); root.add(progress);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(.28, .42, spec.id === 'core' ? 1.6 : .88, 12), material(spec.color, spec.color, 1.7, .2));
      core.position.y = spec.id === 'core' ? .92 : .56; root.add(core);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(.055, .16, spec.id === 'core' ? 5.5 : 3.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = spec.id === 'core' ? 3.1 : 1.9; root.add(beam);
      root.userData.progress = progress; root.userData.beam = beam; root.userData.core = core; root.userData.label = spec.label;
      this.world.add(root); this.tacticalNodeMeshes.set(spec.id, root);
    });
  }

  private addMountainSeaCitadel(
    palette: ReturnType<ThreeRenderer['seasonPalette']>,
    season: SeasonId,
  ): void {
    const cliffMat = material(palette.mountain, palette.mountainGlow, .08, .9);
    const fortressMat = material(0x19313b, SEASONS[season].accent, .24, .42);
    const lightMat = material(SEASONS[season].accent, SEASONS[season].accent, 1.55, .18);
    const citadel = new THREE.Group(); citadel.position.set(0, 0, -13.1);
    const mesa = new THREE.Mesh(new THREE.CylinderGeometry(5.1, 6.4, 2.9, 12), cliffMat); mesa.position.y = .8; mesa.scale.z = .62; citadel.add(mesa);
    const keep = roundedBox(4.4, 2.35, 2.1, .22, fortressMat); keep.position.y = 2.72; citadel.add(keep);
    for (const x of [-2.45, 2.45]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(.72, .9, 3.6, 10), fortressMat); tower.position.set(x, 2.85, 0); citadel.add(tower);
      const crown = new THREE.Mesh(new THREE.TorusGeometry(.62, .09, 8, 30), lightMat); crown.position.set(x, 4.58, 0); crown.rotation.x = Math.PI / 2; crown.userData.spinSpeed = x < 0 ? .38 : -.38; citadel.add(crown); this.animatedWorld.push(crown);
    }
    const citadelCore = new THREE.Mesh(new THREE.OctahedronGeometry(.55, 1), lightMat); citadelCore.position.set(0, 4.3, .1); citadelCore.userData.floatPhase = 1.7; citadel.add(citadelCore); this.animatedWorld.push(citadelCore);
    const gate = roundedBox(1.25, 1.65, .24, .14, lightMat); gate.position.set(0, 2.25, 1.12); citadel.add(gate);
    citadel.userData.balancedDetail = true; citadel.userData.proceduralVista = true; this.world.add(citadel);

    // Layered settlements and cliff terraces create the long sight-lines of
    // the mountain/sea reference without shrinking the readable combat floor.
    for (const side of [-1, 1]) {
      const terrace = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.2, 4.3), cliffMat);
      terrace.position.set(side * 8.7, .45, -13.3); terrace.rotation.y = side * .08; terrace.castShadow = true; terrace.userData.proceduralVista = true; this.world.add(terrace);
      for (let i = 0; i < 4; i += 1) {
        const home = new THREE.Group();
        const shell = roundedBox(1.05, .78 + (i % 2) * .2, .9, .12, fortressMat); shell.position.y = .42; home.add(shell);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(.78, .55, 4), material(i % 2 ? 0x284c54 : 0x403341, SEASONS[season].accent, .18, .58));
        roof.position.y = 1.12; roof.rotation.y = Math.PI / 4; home.add(roof);
        const windowLight = new THREE.Mesh(new THREE.BoxGeometry(.34, .18, .035), lightMat); windowLight.position.set(0, .56, .47); home.add(windowLight);
        home.position.set(side * (6.3 + i * 1.25), 1.54 + (i % 2) * .18, -12.1 - (i % 2) * 1.2);
        home.rotation.y = side * -.12; home.userData.balancedDetail = true; home.userData.proceduralVista = true; this.world.add(home);
      }
    }

    const cableCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-10.8, 5.2, -12.1), new THREE.Vector3(0, 6.6, -14.4), new THREE.Vector3(10.8, 5.2, -12.1),
    ]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 52, .025, 5, false), new THREE.MeshBasicMaterial({ color: 0x8fefff, transparent: true, opacity: .44 }));
    cable.userData.balancedDetail = true; cable.userData.proceduralVista = true; this.world.add(cable);
    const gondola = roundedBox(1.15, .76, .82, .15, material(0xffc928, 0xffa318, .62, .32));
    gondola.position.set(-5.3, 5.85, -13.25); gondola.userData.floatPhase = 3.4; gondola.userData.gondola = true; gondola.userData.balancedDetail = true; gondola.userData.proceduralVista = true; this.world.add(gondola); this.animatedWorld.push(gondola);

    const stormWall = new THREE.Mesh(new THREE.TorusGeometry(14.7, .075, 8, 128), new THREE.MeshBasicMaterial({
      color: season === 'summer' ? 0xb98cff : 0x53e9ff, transparent: true, opacity: .34,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    stormWall.rotation.x = Math.PI / 2; stormWall.position.y = 1.15; stormWall.userData.spinSpeed = .025; stormWall.userData.balancedDetail = true;
    this.world.add(stormWall); this.animatedWorld.push(stormWall);

    for (const side of [-1, 1]) {
      const cliff = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4, 1), cliffMat);
      cliff.scale.set(1.6, 1.25, .92); cliff.position.set(side * 11.2, 1.45, -10.8); cliff.rotation.y = side * .34; cliff.userData.proceduralVista = true; this.world.add(cliff);
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 3.4, 1, 8), new THREE.MeshBasicMaterial({ color: 0xa9f5ff, transparent: true, opacity: .58, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      fall.position.set(side * 10.5, 1.65, -8.9); fall.rotation.z = side * .05; fall.userData.flowPhase = side; fall.userData.proceduralVista = true; this.world.add(fall); this.animatedWorld.push(fall);
    }
  }

  private animateWorld(dt: number): void {
    this.animatedWorld.forEach((object) => {
      const spinSpeed = object.userData.spinSpeed as number | undefined;
      if (spinSpeed) object.rotation.z += dt * spinSpeed;
      const floatPhase = object.userData.floatPhase as number | undefined;
      if (floatPhase !== undefined) {
        object.rotation.y += dt * .65;
        if (object.userData.gondola) {
          object.position.x = Math.sin(this.elapsed * .18) * 7.2;
          object.position.y = 6.15 + Math.cos(this.elapsed * .36) * .36;
        } else object.position.y = 4.3 + Math.sin(this.elapsed * 1.7 + floatPhase) * .18;
      }
      const flowPhase = object.userData.flowPhase as number | undefined;
      if (flowPhase !== undefined && object instanceof THREE.Mesh) {
        (object.material as THREE.MeshBasicMaterial).opacity = .48 + Math.sin(this.elapsed * 4.2 + flowPhase) * .14;
      }
      if (object.userData.waterFlow && object instanceof THREE.Mesh) {
        const waterMaterial = object.material as THREE.MeshPhysicalMaterial;
        waterMaterial.emissiveIntensity = .2 + Math.sin(this.elapsed * 1.8) * .055;
      }
      if (object.userData.backdropFade && object instanceof THREE.Mesh) {
        const backdropMaterial = object.material as THREE.MeshBasicMaterial;
        backdropMaterial.opacity = Math.min(.94, backdropMaterial.opacity + dt * 1.7);
      }
    });
  }

  private seasonPalette(season: SeasonId): { sky: number; fog: number; hemi: number; sun: number; ground: number; highland: number; water: number; waterGlow: number; mountain: number; mountainGlow: number; leaf: number; leafGlow: number; blossom: number; particle: number } {
    if (season === 'summer') return { sky: 0x244d69, fog: 0x31536a, hemi: 0x9edcff, sun: 0xffe7ad, ground: 0x315f43, highland: 0x254c38, water: 0x167f9e, waterGlow: 0x063d54, mountain: 0x315a46, mountainGlow: 0x102d24, leaf: 0x5da64e, leafGlow: 0x173c22, blossom: 0xffd36f, particle: 0x9ecbff };
    if (season === 'autumn') return { sky: 0x9a7768, fog: 0x8a705d, hemi: 0xffd3a0, sun: 0xffe1ac, ground: 0x6d5a36, highland: 0x59462d, water: 0x3989a0, waterGlow: 0x173c4b, mountain: 0x66513c, mountainGlow: 0x2f2117, leaf: 0xd86c35, leafGlow: 0x5f2618, blossom: 0xffc15b, particle: 0xffb04f };
    if (season === 'winter') return { sky: 0x526f86, fog: 0x7896a7, hemi: 0xb8deea, sun: 0xdff7ff, ground: 0x8da9b4, highland: 0x718e9b, water: 0x75bfd6, waterGlow: 0x205d78, mountain: 0x607986, mountainGlow: 0x203744, leaf: 0x9eb7c0, leafGlow: 0x365461, blossom: 0xeefcff, particle: 0xe9fbff };
    return { sky: 0x79bed2, fog: 0x5d9bab, hemi: 0xc8efff, sun: 0xfff0ca, ground: 0x4d8154, highland: 0x3e6c48, water: 0x2aa5bd, waterGlow: 0x073f51, mountain: 0x4e8d65, mountainGlow: 0x102d2a, leaf: 0x6dbb69, leafGlow: 0x244d31, blossom: 0xffacd0, particle: 0xffb6d2 };
  }

  private updateWeatherParticles(dt: number): void {
    if (!this.expeditionSeason || !this.weatherParticles.length) return;
    const intensity = this.simulation?.weather.intensity ?? .35;
    this.weatherParticles.forEach((particle, index) => {
      const seed = (particle.userData.seed as number | undefined) ?? index * .17;
      if (this.expeditionSeason === 'autumn') {
        particle.position.x += dt * (1.6 + intensity * 3.4); particle.position.y += Math.sin(this.elapsed * 2 + seed) * dt * .3; particle.rotation.z += dt * 2.4;
      } else {
        const fall = this.expeditionSeason === 'winter' ? .7 + intensity * 1.4 : 4.5 + intensity * 8;
        particle.position.y -= dt * fall; particle.position.x += Math.sin(this.elapsed + seed) * dt * (this.expeditionSeason === 'winter' ? .35 : 1.2);
      }
      if (particle.position.y < .05 || particle.position.x > 15) {
        particle.position.x = -14 + Math.random() * 28; particle.position.y = 6 + Math.random() * 6; particle.position.z = -12 + Math.random() * 24;
      }
      const qualityRatio = this.quality === 'high' ? 1 : this.quality === 'balanced' ? .7 : .38;
      particle.visible = index / this.weatherParticles.length < (.32 + intensity * .68) * qualityRatio;
    });
    if (!this.reduceFlashes && this.simulation?.weather.warning && this.expeditionSeason === 'summer') {
      const pulse = .78 + Math.max(0, Math.sin(this.elapsed * 7)) * .2;
      this.renderer.toneMappingExposure = pulse;
    } else if (this.viewMode === 'arena') this.renderer.toneMappingExposure = this.expeditionSeason === 'winter' ? .7 : this.expeditionSeason ? .66 : .74;
    this.world.children.forEach((child) => {
      if (child.userData.routeBeacon && child instanceof THREE.Mesh && child.geometry.type === 'RingGeometry') child.rotation.z += dt * .7;
      if (child.userData.distantCloud) child.position.x = child.position.x > 16 ? -16 : child.position.x + dt * .08;
    });
  }

  private buildWorkshop(loadout: TankLoadout, season: SeasonId): void {
    this.worldGeneration += 1;
    const palette = this.seasonPalette(season);
    this.weatherParticles = [];
    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.FogExp2(palette.fog, .013);
    const hemi = new THREE.HemisphereLight(palette.hemi, 0x172116, 1.05);
    const sun = new THREE.DirectionalLight(palette.sun, 1.75); sun.position.set(-8, 14, 10); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const cyan = new THREE.PointLight(0x32ddff, 4.8, 16, 2); cyan.position.set(-1, 4, 2);
    this.world.add(hemi, sun, cyan);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 24), new THREE.MeshStandardMaterial({ color: 0x0a151f, metalness: .72, roughness: .34 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.world.add(floor);
    const hangar = material(0x101b24, 0x142c38, .2, .52);
    const beams = [[-8, 4, 0, .45, 8, 18], [8, 4, 0, .45, 8, 18], [0, 7.7, -3, 16, .42, .55]];
    beams.forEach(([x, y, z, w, h, d]) => { const beam = new THREE.Mesh(new THREE.BoxGeometry(w!, h!, d!), hangar); beam.position.set(x!, y!, z!); beam.castShadow = true; this.world.add(beam); });

    // Layered mountain-and-sea destination visible through the hangar mouth.
    const skyWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshBasicMaterial({ color: palette.sky, fog: false }));
    skyWall.position.set(0, 5.4, -11.8); this.world.add(skyWall);
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshBasicMaterial({ color: 0xffefba, transparent: true, opacity: .92, fog: false }));
    sunDisc.position.set(6.5, 7.5, -11.65); this.world.add(sunDisc);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(30, 18, 16, 16), new THREE.MeshPhysicalMaterial({ color: palette.water, emissive: palette.waterGlow, emissiveIntensity: .12, roughness: season === 'winter' ? .08 : .18, metalness: season === 'winter' ? .42 : .1, transparent: true, opacity: .94 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, -.12, -14); this.world.add(water);
    const mountainMat = material(palette.mountain, palette.mountainGlow, .06, .9);
    for (let i = 0; i < 11; i += 1) {
      const height = 3.2 + (i % 4) * 1.2;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(2.2 + (i % 3) * .6, height, 7), mountainMat);
      mountain.position.set(-14 + i * 2.8, height / 2 - .35, -9.8 - Math.abs(5 - i) * .28); mountain.rotation.y = i * .37; this.world.add(mountain);
    }
    const cliffMat = material(0x355f49, 0x17392d, .08, .82);
    const cliff = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.8, 1.5), cliffMat); cliff.position.set(4.7, 2.15, -8.8); cliff.rotation.z = -.08; this.world.add(cliff);
    const waterfall = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 4.15, 1, 10), new THREE.MeshBasicMaterial({ color: 0xbdf7ff, transparent: true, opacity: .82, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    waterfall.position.set(4.25, 2.35, -7.98); waterfall.rotation.z = -.08; this.world.add(waterfall);
    const treeTrunkMat = material(0x5a3c26, 0x1d100b, .04, .9); const leafMat = material(palette.leaf, palette.leafGlow, .1, .8); const blossomMat = material(palette.blossom, palette.leafGlow, .14, .78);
    for (let i = 0; i < 14; i += 1) {
      const tree = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, .75, 7), treeTrunkMat); trunk.position.y = .37; tree.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.38 + (i % 3) * .06, 1), season === 'spring' && i % 3 === 0 ? blossomMat : leafMat); crown.position.y = .88; crown.scale.set(1.2, .95, 1); tree.add(crown);
      tree.position.set(-9 + (i * 1.55) % 18, .1, -7.3 - (i % 3) * .75); this.world.add(tree);
    }
    const petalMat = new THREE.MeshBasicMaterial({ color: palette.particle, transparent: true, opacity: .8 });
    for (let i = 0; i < 32; i += 1) { const petal = new THREE.Mesh(new THREE.SphereGeometry(.035, 5, 4), petalMat); petal.scale.set(season === 'summer' ? .4 : 2, season === 'winter' ? 1 : .25, 1); petal.position.set(-8 + Math.random() * 16, .5 + Math.random() * 6, -3 - Math.random() * 14); petal.userData.weather = true; this.world.add(petal); this.weatherParticles.push(petal); }

    const platform = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.55, 3.8, .38, 64), material(0x17242e, 0x18bddc, .36, .25)); disc.position.y = .18; disc.receiveShadow = true; platform.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.25, .08, 8, 64), new THREE.MeshBasicMaterial({ color: 0x41eaff })); ring.rotation.x = Math.PI / 2; ring.position.y = .4; platform.add(ring);
    this.workshopTurntable = platform; this.world.add(platform);

    this.workshopArm = this.createWorkshopArm(); this.workshopArm.position.set(3.5, .2, .8); this.world.add(this.workshopArm);
    this.workshopTank = this.createTank(1, loadout); this.workshopTank.scale.setScalar(1.72); this.workshopTank.position.set(-.55, .48, .1); this.workshopTank.rotation.y = .72; this.entityRoot.add(this.workshopTank);
    const tankBuddy = this.workshopTank.userData.companion as THREE.Group | undefined; if (tankBuddy) tankBuddy.visible = false;
    const workshopBuddy = this.createWorkshopBuddy(); workshopBuddy.position.set(-3.35, .42, 1.1); workshopBuddy.rotation.y = .35; this.world.add(workshopBuddy);
    const generation = this.workshopGeneration;
    void this.attachWorkshopProp(generation);
  }

  private async attachWorkshopProp(generation: number): Promise<void> {
    const expectedWorld = this.world;
    const prop = await this.modelAssets.instantiate('workshop-prop');
    if (!prop || generation !== this.workshopGeneration || this.viewMode !== 'workshop' || expectedWorld !== this.world) {
      if (prop) disposeObjectTree(prop);
      return;
    }
    if (this.workshopProp) removeAndDispose(this.world, this.workshopProp);
    prop.position.set(-4.9, .1, -1.8); prop.scale.setScalar(.72); this.world.add(prop);
    this.workshopProp = prop;
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
    this.syncCollection(sim.players, this.playerMeshes, (entity) => this.createTank(entity.slot, sim.options.loadout, sim.options.companion));
    this.syncCollection(sim.enemies, this.enemyMeshes, (entity) => this.createEnemy(entity));
    this.syncCollection(sim.projectiles, this.bulletMeshes, (entity) => this.createBullet(entity));
    this.syncCollection(sim.pickups, this.pickupMeshes, (entity) => this.createPickup(entity));

    sim.players.forEach((player) => {
      const group = this.playerMeshes.get(player.id); if (!group) return;
      group.position.set(player.pos.x, player.alive ? 0 : -.25, player.pos.z);
      // The modeled barrel faces local -Z, so add PI to align it with the
      // simulation aim vector and the projectile trajectory.
      group.rotation.y = Math.atan2(player.aim.x, player.aim.z) + Math.PI;
      group.visible = player.alive || player.downTimer > 0;
      group.userData.trackTime = (group.userData.trackTime ?? 0) + .12;
      const turret = group.userData.turret as THREE.Group | undefined;
      if (turret) {
        const recoil = (group.userData.recoil as number | undefined) ?? 0;
        turret.position.y = .64 + Math.sin(this.elapsed * 4 + player.slot) * .025;
        turret.position.z = recoil;
        group.userData.recoil = Math.max(0, recoil - .045);
      }
      const companion = group.userData.companion as THREE.Group | undefined;
      if (companion) { companion.position.y = 1.25 + Math.sin(this.elapsed * 3.2 + player.slot) * .14; companion.rotation.y += .025; }
      const shield = group.userData.shield as THREE.Mesh | undefined;
      const visualRoot = group.userData.visualRoot as THREE.Group | undefined;
      if (visualRoot) visualRoot.visible = this.reduceFlashes || player.invulnerable <= 0 ? true : Math.sin(this.elapsed * 18) > -.25;
      if (shield) { shield.visible = player.shield > 0; shield.rotation.y += .025; }
      if (player.alive) this.spawnSurfaceTrail(player);
    });

    const livingPlayers = sim.players.filter((player) => player.alive);
    if (livingPlayers.length) {
      const focus = livingPlayers.reduce((sum, player) => ({ x: sum.x + player.pos.x, z: sum.z + player.pos.z }), { x: 0, z: 0 });
      focus.x /= livingPlayers.length; focus.z /= livingPlayers.length;
      this.cameraTarget.lerp(new THREE.Vector3(THREE.MathUtils.clamp(focus.x * .22, -1.8, 1.8), 0, THREE.MathUtils.clamp(focus.z * .16, -1.3, 1.3)), .055);
    }

    sim.enemies.forEach((enemy) => {
      const group = this.enemyMeshes.get(enemy.id); if (!group) return;
      group.position.set(enemy.pos.x, .04 + Math.sin(enemy.phase * 3) * .05, enemy.pos.z);
      group.rotation.y = Math.atan2(enemy.vel.x, enemy.vel.z);
      group.rotation.z = Math.sin(enemy.phase * 2) * .03;
      const body = group.userData.body as THREE.Mesh | undefined;
      if (body) {
        const mat = body.material as THREE.MeshStandardMaterial;
        const baseIntensity = enemy.kind === 'boss' ? 1.5 : .8;
        mat.emissiveIntensity = enemy.hitFlash > 0 ? (this.reduceFlashes ? baseIntensity + .25 : 3) : baseIntensity;
        mat.color.setHex(enemy.hitFlash > 0 && !this.reduceFlashes ? 0xffffff : (group.userData.baseColor as number | undefined) ?? ENEMIES[enemy.kind].color);
      }
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((candidate) => {
          if (!(candidate instanceof THREE.Material)) return;
          if (candidate.userData.baseOpacity === undefined && 'opacity' in candidate) candidate.userData.baseOpacity = candidate.opacity;
          if (candidate.userData.baseTransparent === undefined) candidate.userData.baseTransparent = candidate.transparent;
          const transparent = enemy.cloaked || Boolean(candidate.userData.baseTransparent);
          if (candidate.transparent !== transparent) {
            candidate.transparent = transparent;
            candidate.needsUpdate = true;
          }
          if (enemy.cloaked && 'opacity' in candidate) candidate.opacity = child === body ? .22 : .38;
          else if ('opacity' in candidate && candidate.userData.baseOpacity !== undefined) candidate.opacity = candidate.userData.baseOpacity as number;
        });
      });
      const hpBar = group.userData.hp as THREE.Mesh | undefined;
      if (hpBar) hpBar.scale.x = Math.max(.001, enemy.hp / enemy.maxHp);
    });

    sim.projectiles.forEach((bullet) => {
      const mesh = this.bulletMeshes.get(bullet.id); if (!mesh) return;
      mesh.position.set(bullet.pos.x, bullet.team === 'player' ? .75 : .55, bullet.pos.z);
      mesh.rotation.y = Math.atan2(bullet.vel.x, bullet.vel.z);
    });
    sim.tacticalNodes.forEach((node) => {
      const group = this.tacticalNodeMeshes.get(node.id); if (!group) return;
      const progress = group.userData.progress as THREE.Mesh | undefined;
      const beam = group.userData.beam as THREE.Mesh | undefined;
      const core = group.userData.core as THREE.Mesh | undefined;
      if (progress) {
        const scale = .08 + node.progress * .92;
        progress.scale.setScalar(scale);
        (progress.material as THREE.MeshBasicMaterial).opacity = node.captured ? .98 : .42 + node.progress * .46;
      }
      if (beam) {
        (beam.material as THREE.MeshBasicMaterial).opacity = node.captured ? .52 + Math.sin(this.elapsed * 6) * .12 : .12 + node.progress * .28;
        beam.scale.y = node.captured ? 1.28 : .55 + node.progress * .45;
      }
      if (core) core.rotation.y += node.captured ? .045 : .015;
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
    if (this.teamMarkerMesh) {
      this.teamMarkerMesh.visible = Boolean(sim.teamMarker);
      if (sim.teamMarker) { this.teamMarkerMesh.position.set(sim.teamMarker.pos.x, .08, sim.teamMarker.pos.z); this.teamMarkerMesh.scale.setScalar(1 + Math.sin(this.elapsed * 7) * .12); }
    }
  }

  private syncCollection<T extends { id: number }, M extends THREE.Object3D>(items: readonly T[], map: Map<number, M>, create: (item: T) => M): void {
    const ids = new Set(items.map((item) => item.id));
    map.forEach((mesh, id) => { if (!ids.has(id)) { removeAndDispose(this.entityRoot, mesh); map.delete(id); } });
    items.forEach((item) => {
      if (map.has(item.id)) return;
      const mesh = create(item); map.set(item.id, mesh); this.entityRoot.add(mesh);
    });
  }

  private createTank(slot: 1 | 2, loadout?: TankLoadout, companionId: CompanionId = 'little-core'): THREE.Group {
    const group = new THREE.Group();
    group.scale.setScalar(1.22);
    const visualRoot = new THREE.Group(); group.add(visualRoot);
    const movementRoot = new THREE.Group(); movementRoot.name = 'PROCEDURAL_MOVEMENT'; visualRoot.add(movementRoot);
    const bodyColor = loadout ? PAINTS[loadout.paint].color : slot === 1 ? 0xffd84a : 0x6ff2ff;
    const bodyMat = material(bodyColor, bodyColor, loadout ? .38 : 1.15);
    const darkMat = material(0x101b29, slot === 1 ? 0xffd84a : 0x5eeaff, .28, .5);
    const cyan = material(0x9af8ff, 0x20dfff, loadout ? .62 : 1.8, .22);
    const body = roundedBox(1.35, .5, 1.75, .24, bodyMat); body.position.y = .46; visualRoot.add(body);
    this.addMovementModule(movementRoot, loadout?.movement ?? 'snow-tread', darkMat, cyan);
    if (loadout) {
      const sideRail = roundedBox(1.5, .16, .34, .07, darkMat); sideRail.position.set(0, .56, .52); visualRoot.add(sideRail);
      for (const x of [-.46, 0, .46]) { const panel = roundedBox(.34, .09, .42, .06, bodyMat); panel.position.set(x, .75, .28); panel.rotation.y = -.08 * x; visualRoot.add(panel); }
      for (const x of [-.46, .46]) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(.24, .12, .08), cyan); lamp.position.set(x, .58, -.89); visualRoot.add(lamp); }
      const rearCore = new THREE.Mesh(new THREE.BoxGeometry(.58, .22, .08), cyan); rearCore.position.set(0, .6, .9); visualRoot.add(rearCore);
    }
    const turret = new THREE.Group(); turret.position.y = .65;
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(.48, .58, .32, 8), darkMat); dome.position.y = .22; dome.castShadow = true; turret.add(dome);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(.18, .18, 1.3), cyan); barrel.position.set(0, .27, -.65); turret.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(.3, .29, .25), bodyMat); muzzle.position.set(0, .27, -1.27); turret.add(muzzle);
    visualRoot.add(turret);
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.22, 20, 12),
      new THREE.MeshBasicMaterial({ color: slot === 1 ? 0x5ef3ff : 0xffee87, wireframe: true, transparent: true, opacity: .25, blending: THREE.AdditiveBlending }),
    );
    shield.position.y = .55; shield.visible = false; group.add(shield);
    const marker = new THREE.Mesh(new THREE.RingGeometry(.86, .94, 32), new THREE.MeshBasicMaterial({ color: slot === 1 ? 0xffd84a : 0x54edff, transparent: true, opacity: .65, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.position.y = .02; group.add(marker);
    const companion = new THREE.Group(); companion.position.set(slot === 1 ? 1.15 : -1.15, 1.25, .4);
    const buddyColor = companionId === 'sprout' ? 0x86ef78 : companionId === 'snowball' ? 0xd7f8ff : slot === 1 ? 0xffd84a : 0x54edff;
    const buddyGeometry = companionId === 'sprout' ? new THREE.SphereGeometry(.19, 10, 7) : companionId === 'snowball' ? new THREE.IcosahedronGeometry(.2, 1) : new THREE.OctahedronGeometry(.18, 0);
    const buddyCore = new THREE.Mesh(buddyGeometry, material(buddyColor, buddyColor, 1.5)); companion.add(buddyCore);
    const buddyRing = new THREE.Mesh(new THREE.TorusGeometry(.27, .025, 5, 20), new THREE.MeshBasicMaterial({ color: buddyColor })); buddyRing.rotation.x = Math.PI / 2; companion.add(buddyRing); group.add(companion);
    group.userData.turret = turret; group.userData.proceduralTurret = turret; group.userData.shield = shield;
    group.userData.companion = companion; group.userData.visualRoot = visualRoot; group.userData.movementRoot = movementRoot;
    group.userData.slot = slot;
    group.userData.loadout = loadout ? { ...loadout, ammoSlots: [...loadout.ammoSlots] } : undefined;
    group.userData.assetSlot = 'player-tank';
    void this.attachOptionalModel(group, visualRoot, 'player-tank', loadout);
    return group;
  }

  private async attachOptionalModel(group: THREE.Group, proceduralRoot: THREE.Group, slot: ModelSlot, loadout?: TankLoadout): Promise<void> {
    const requestId = ++this.assetRequestSerial;
    group.userData.assetRequestId = requestId;
    const model = await this.modelAssets.instantiate(slot); if (!model) return;
    if (!group.parent || group.userData.assetRequestId !== requestId) { disposeObjectTree(model); return; }
    const previous = group.userData.assetModel as THREE.Group | undefined;
    if (previous) removeAndDispose(proceduralRoot, previous);
    const movementRoot = group.userData.movementRoot as THREE.Group | undefined;
    proceduralRoot.children.forEach((child) => { child.visible = child === movementRoot; });
    this.applyTankModelStyle(model, loadout, group.userData.slot as 1 | 2);
    proceduralRoot.add(model);
    const namedTurret = model.getObjectByName('CYBER_TURRET');
    if (namedTurret) group.userData.turret = namedTurret;
    else group.userData.turret = group.userData.proceduralTurret;
    group.userData.assetModel = model;
    group.userData.externalModel = true;
  }

  private applyTankModelStyle(model: THREE.Group, loadout: TankLoadout | undefined, slot: 1 | 2): void {
    const paint = loadout ? PAINTS[loadout.paint].color : slot === 1 ? 0xffd84a : 0x6ff2ff;
    const lightColors = { cyan: 0x35e8ff, gold: 0xffd84a, lime: 0x8cff72, violet: 0xa77cff } as const;
    const light = loadout ? lightColors[loadout.light] : slot === 1 ? lightColors.gold : lightColors.cyan;
    model.traverse((object) => {
      const name = object.name.toUpperCase();
      if (/(^|_)(WHEEL|HUB|TRACK)/.test(name)) object.visible = false;
      if (!(object instanceof THREE.Mesh)) return;
      const entries = Array.isArray(object.material) ? object.material : [object.material];
      entries.forEach((entry) => {
        if (!(entry instanceof THREE.MeshStandardMaterial)) return;
        if (/(ARMORED|BODY|CHASSIS|MUZZLE|SUNRISE)/.test(name) || /SUNRISE|ALLOY/i.test(entry.name)) {
          entry.color.setHex(paint);
          entry.emissive.setHex(paint);
          entry.emissiveIntensity = .34;
        }
        if (/(ENERGY|LIGHT|CORE|BARREL|SENSOR)/.test(name) || /CYAN|ENERGY|SENSOR/i.test(entry.name)) {
          entry.color.setHex(light);
          entry.emissive.setHex(light);
          entry.emissiveIntensity = 1.25;
        }
      });
    });
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
    const visualColor = enemy.bossVariant === 'tide-leviathan' ? 0x36dff2 : enemy.bossVariant === 'ridge-colossus' ? 0xff7b3f : enemy.bossVariant === 'storm-roc' ? 0xd06cff : enemy.bossVariant === 'frost-mammoth' ? 0xa8f5ff : def.color;
    const bodyMat = material(visualColor, visualColor, enemy.kind === 'boss' ? 1.45 : .85);
    const darkMat = material(0x121321, visualColor, .22, .52);
    let body: THREE.Mesh;
    if (enemy.kind === 'charger') body = new THREE.Mesh(new THREE.ConeGeometry(.55, 1.35, 5), bodyMat);
    else if (enemy.kind === 'bulwark') body = roundedBox(1.55, .75, 1.55, .18, bodyMat);
    else if (enemy.kind === 'splitter') body = new THREE.Mesh(new THREE.OctahedronGeometry(.9, 0), bodyMat);
    else if (enemy.kind === 'medic') body = new THREE.Mesh(new THREE.TorusKnotGeometry(.4, .16, 48, 8), bodyMat);
    else if (enemy.kind === 'sniper') body = new THREE.Mesh(new THREE.ConeGeometry(.7, 1.4, 3), bodyMat);
    else if (enemy.kind === 'stalker') body = new THREE.Mesh(new THREE.IcosahedronGeometry(.66, 0), bodyMat);
    else if (enemy.kind === 'summoner') body = new THREE.Mesh(new THREE.TorusKnotGeometry(.58, .21, 64, 10), bodyMat);
    else if (enemy.kind === 'reflector') body = new THREE.Mesh(new THREE.SphereGeometry(.92, 8, 6), bodyMat);
    else if (enemy.kind === 'warden') body = new THREE.Mesh(new THREE.CylinderGeometry(.76, 1, 1.1, 6), bodyMat);
    else if (enemy.kind === 'boss' && enemy.bossVariant === 'tide-leviathan') {
      body = new THREE.Mesh(new THREE.SphereGeometry(1.45, 18, 12), bodyMat); body.scale.set(1.35, .85, 1.1);
    } else if (enemy.kind === 'boss' && enemy.bossVariant === 'storm-roc') {
      body = new THREE.Mesh(new THREE.OctahedronGeometry(1.62, 1), bodyMat); body.scale.set(1.45, .75, 1);
    } else if (enemy.kind === 'boss' && enemy.bossVariant === 'frost-mammoth') {
      body = roundedBox(2.65, 1.55, 2.25, .36, bodyMat);
    } else if (enemy.kind === 'boss') body = new THREE.Mesh(new THREE.DodecahedronGeometry(1.65, 1), bodyMat);
    else body = new THREE.Mesh(new THREE.CylinderGeometry(.55, .7, .65, enemy.kind === 'gunner' ? 6 : 10), bodyMat);
    body.position.y = enemy.kind === 'boss' ? 1.55 : .62;
    if (enemy.kind === 'charger' || enemy.kind === 'sniper') body.rotation.x = Math.PI / 2;
    body.castShadow = true; group.add(body);
    const core = new THREE.Mesh(new THREE.SphereGeometry(enemy.kind === 'boss' ? .48 : .23, 12, 8), material(0xffffff, visualColor, 2.2, .15));
    core.position.set(0, enemy.kind === 'boss' ? 1.55 : .7, -.5); group.add(core);
    if (enemy.kind === 'boss') {
      if (enemy.bossVariant === 'tide-leviathan') {
        for (let i = 0; i < 3; i += 1) { const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45 + i * .18, .075, 8, 42), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : visualColor, transparent: true, opacity: .75, blending: THREE.AdditiveBlending })); ring.rotation.x = Math.PI / 2 + i * .22; ring.position.y = 1.55; group.add(ring); }
        for (const side of [-1, 1]) { const fin = new THREE.Mesh(new THREE.ConeGeometry(.46, 1.5, 4), darkMat); fin.position.set(side * 1.55, 1.45, .2); fin.rotation.z = side * Math.PI / 2; group.add(fin); }
      } else {
        for (let i = 0; i < 8; i += 1) { const spike = new THREE.Mesh(new THREE.ConeGeometry(.2, 1.05, 5), darkMat); spike.position.set(Math.cos(i * Math.PI / 4) * 1.72, 1.55, Math.sin(i * Math.PI / 4) * 1.72); spike.rotation.z = Math.PI / 2; spike.rotation.y = -i * Math.PI / 4; group.add(spike); }
        const crown = new THREE.Mesh(new THREE.TorusGeometry(1.02, .12, 7, 32), new THREE.MeshBasicMaterial({ color: 0xffd05a, blending: THREE.AdditiveBlending })); crown.rotation.x = Math.PI / 2; crown.position.y = 2.4; group.add(crown);
      }
    } else if (enemy.kind === 'reflector') {
      const shield = new THREE.Mesh(new THREE.TorusGeometry(1.02, .09, 8, 32), new THREE.MeshBasicMaterial({ color: 0xdfffff, transparent: true, opacity: .65, blending: THREE.AdditiveBlending }));
      shield.rotation.x = Math.PI / 2; shield.position.y = .7; shield.material.userData.baseOpacity = .65; group.add(shield);
    } else if (enemy.kind === 'summoner') {
      for (let i = 0; i < 3; i += 1) { const pod = new THREE.Mesh(new THREE.SphereGeometry(.18, 8, 6), darkMat); const a = i / 3 * Math.PI * 2; pod.position.set(Math.cos(a) * .9, .72, Math.sin(a) * .9); group.add(pod); }
    } else if (enemy.kind === 'warden') {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.22, .22, 1.8), darkMat); rail.position.set(0, 1.08, -.35); group.add(rail);
    }
    const hpBack = new THREE.Mesh(new THREE.PlaneGeometry(enemy.kind === 'boss' ? 3 : 1.3, .11), new THREE.MeshBasicMaterial({ color: 0x1a1f2b, side: THREE.DoubleSide }));
    hpBack.position.set(0, enemy.kind === 'boss' ? 3.25 : 1.55, 0); hpBack.rotation.x = -Math.PI / 4; group.add(hpBack);
    const hp = new THREE.Mesh(new THREE.PlaneGeometry(enemy.kind === 'boss' ? 2.9 : 1.2, .065), new THREE.MeshBasicMaterial({ color: enemy.kind === 'boss' ? 0xffd34a : 0x75ffad, side: THREE.DoubleSide }));
    hp.position.set(0, enemy.kind === 'boss' ? 3.24 : 1.54, -.02); hp.rotation.x = -Math.PI / 4; group.add(hp);
    group.userData.body = body; group.userData.hp = hp; group.userData.hpBack = hpBack; group.userData.baseColor = visualColor;
    group.userData.assetSlot = enemy.kind === 'boss' ? 'enemy-boss' : undefined;
    if (enemy.kind === 'boss') void this.attachBossModel(group);
    return group;
  }

  private async attachBossModel(group: THREE.Group): Promise<void> {
    const requestId = ++this.assetRequestSerial;
    group.userData.assetRequestId = requestId;
    const model = await this.modelAssets.instantiate('enemy-boss'); if (!model) return;
    if (!group.parent || group.userData.assetRequestId !== requestId) { disposeObjectTree(model); return; }
    const previous = group.userData.assetModel as THREE.Group | undefined;
    if (previous) removeAndDispose(group, previous);
    const hp = group.userData.hp as THREE.Object3D | undefined;
    const hpBack = group.userData.hpBack as THREE.Object3D | undefined;
    group.children.slice().forEach((child) => { if (child !== hp && child !== hpBack) child.visible = false; });
    group.add(model); group.userData.assetModel = model; group.userData.externalModel = true;
  }

  private refreshExternalModels(): void {
    const tanks = new Set<THREE.Group>([
      ...this.playerMeshes.values(),
      ...this.replayGhosts,
      ...(this.workshopTank ? [this.workshopTank] : []),
    ]);
    tanks.forEach((group) => {
      const visualRoot = group.userData.visualRoot as THREE.Group | undefined;
      if (!visualRoot) return;
      void this.attachOptionalModel(group, visualRoot, 'player-tank', group.userData.loadout as TankLoadout | undefined);
    });
    this.enemyMeshes.forEach((group) => {
      if (group.userData.assetSlot === 'enemy-boss') void this.attachBossModel(group);
    });
    if (this.viewMode === 'workshop') {
      this.workshopGeneration += 1;
      void this.attachWorkshopProp(this.workshopGeneration);
    }
  }

  private invalidateWorkshopRequests(): void {
    this.workshopGeneration += 1;
    this.workshopProp = undefined;
  }

  private createBullet(bullet: ProjectileEntity): THREE.Mesh {
    let bulletMaterial = this.bulletMaterials.get(bullet.color);
    if (!bulletMaterial) {
      bulletMaterial = new THREE.MeshBasicMaterial({ color: bullet.color, transparent: true, opacity: .96, blending: THREE.AdditiveBlending });
      this.bulletMaterials.set(bullet.color, bulletMaterial);
    }
    const mesh = new THREE.Mesh(this.bulletGeometry[bullet.team], bulletMaterial);
    mesh.userData.retainSharedResources = true;
    if (bullet.team === 'player' && this.quality !== 'battery') {
      const glow = new THREE.PointLight(bullet.color, this.quality === 'high' ? 1.8 : .9, 2.6, 2);
      glow.position.z = -.18; mesh.add(glow);
    }
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
      if (particle.life <= 0) { removeAndDispose(this.effectRoot, particle.mesh); this.particles.splice(i, 1); }
    }
  }

  private spawnSurfaceTrail(player: PlayerEntity): void {
    const previous = this.lastTrailPositions.get(player.id);
    if (previous && Math.hypot(player.pos.x - previous.x, player.pos.z - previous.z) < (this.quality === 'battery' ? .78 : .52)) return;
    this.lastTrailPositions.set(player.id, { ...player.pos });
    const water = player.surface === 'shallow-water' || player.surface === 'deep-water';
    const color = water ? 0x8eefff : player.surface === 'mud' ? 0x6a4228 : player.surface === 'sand' ? 0xe3bc72 : player.surface === 'ice' ? 0xb9f5ff : player.surface === 'deep-snow' ? 0xe9fbff : 0x4fe8ff;
    const life = water ? .58 : player.surface === 'road' ? 1.2 : 2.4;
    const angle = Math.atan2(player.aim.x, player.aim.z);
    const count = water || this.quality === 'battery' ? 1 : 2;
    for (let i = 0; i < count; i += 1) {
      const geometry = water ? new THREE.RingGeometry(.18, .28, 24) : new THREE.PlaneGeometry(.18, .58);
      const mark = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: water ? .66 : .24, side: THREE.DoubleSide, depthWrite: false, blending: water ? THREE.AdditiveBlending : THREE.NormalBlending }));
      mark.rotation.x = -Math.PI / 2; mark.rotation.z = -angle;
      const side = count === 2 ? (i === 0 ? -.48 : .48) : 0;
      mark.position.set(player.pos.x + Math.cos(angle) * side, .018, player.pos.z - Math.sin(angle) * side);
      this.effectRoot.add(mark); this.trailMarks.push({ mesh: mark, life, maxLife: life, expanding: water });
    }
    if ((water || player.surface === 'mud' || player.surface === 'deep-snow') && this.particles.length < this.particleBudget && Math.random() < .45) {
      const amount = this.quality === 'high' ? 4 : 2;
      for (let i = 0; i < amount; i += 1) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(.035, 5, 4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .75 }));
        mesh.position.set(player.pos.x + (Math.random() - .5) * .8, .18, player.pos.z + (Math.random() - .5) * .8); this.effectRoot.add(mesh);
        const maxLife = .34 + Math.random() * .22;
        this.particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - .5) * 1.8, 1.2 + Math.random() * 1.6, (Math.random() - .5) * 1.8), life: maxLife, maxLife, spin: new THREE.Vector3() });
      }
    }
    const limit = this.quality === 'high' ? 180 : this.quality === 'balanced' ? 110 : 55;
    while (this.trailMarks.length > limit) this.removeTrailMark(0);
  }

  private updateTrailMarks(dt: number): void {
    for (let i = this.trailMarks.length - 1; i >= 0; i -= 1) {
      const mark = this.trailMarks[i]; if (!mark) continue;
      mark.life -= dt; const ratio = Math.max(0, mark.life / mark.maxLife);
      (mark.mesh.material as THREE.MeshBasicMaterial).opacity = (mark.expanding ? .62 : .25) * ratio;
      if (mark.expanding) mark.mesh.scale.addScalar(dt * 1.8);
      if (mark.life <= 0) this.removeTrailMark(i);
    }
  }

  private removeTrailMark(index: number): void {
    const mark = this.trailMarks[index]; if (!mark) return;
    this.effectRoot.remove(mark.mesh); mark.mesh.geometry.dispose(); (mark.mesh.material as THREE.Material).dispose(); this.trailMarks.splice(index, 1);
  }

  private applyQualityVisuals(): void {
    const factor = this.quality === 'high' ? 1 : this.quality === 'balanced' ? .74 : .42;
    const base = this.viewMode === 'workshop' ? .18 : this.expeditionSeason ? .52 : .44;
    const comfortFactor = this.reduceFlashes ? .35 : 1;
    this.bloom.threshold = this.reduceFlashes ? .9 : this.viewMode === 'workshop' ? .88 : this.expeditionSeason ? .68 : .72;
    this.bloom.strength = base * factor * comfortFactor;
    this.bloom.radius = this.reduceFlashes ? .16 : this.quality === 'high' ? .38 : this.quality === 'balanced' ? .3 : .16;
    this.bloom.enabled = this.quality !== 'battery';
    this.renderer.toneMappingExposure = this.viewMode === 'workshop' ? .52 : this.expeditionSeason === 'winter' ? .7 : this.expeditionSeason ? .66 : .74;
    this.world.traverse((object) => {
      if (object.userData.forceHidden) { object.visible = false; return; }
      if (object.userData.highDetail) object.visible = this.quality === 'high';
      if (object.userData.balancedDetail) object.visible = this.quality !== 'battery';
    });
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

  private onContextLost = (event: Event): void => {
    event.preventDefault(); this.contextListener?.('lost');
  };

  private onContextRestored = (): void => {
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((mat) => { mat.needsUpdate = true; }); object.geometry.attributes.position.needsUpdate = true;
    });
    this.applyQualityVisuals(); this.resize(); this.contextListener?.('restored');
  };

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.camera.aspect = width / height;
    const compact = width / height < .78;
    this.camera.fov = compact ? 56 : 44;
    if (this.viewMode !== 'workshop') this.camera.position.z = compact ? 23 : 21.4;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  }

  private clearEntities(): void {
    this.playerMeshes.clear(); this.enemyMeshes.clear(); this.bulletMeshes.clear(); this.pickupMeshes.clear();
    clearAndDispose(this.entityRoot);
    while (this.trailMarks.length) this.removeTrailMark(this.trailMarks.length - 1);
    this.lastTrailPositions.clear();
  }
}

function hasRetainedFlag(object: THREE.Object3D, root: THREE.Object3D, flag: 'retainSharedResources' | 'retainSharedGeometry' | 'retainSharedMaterial'): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.retainSharedResources || current.userData[flag]) return true;
    if (current === root) break;
    current = current.parent;
  }
  return false;
}

export function disposeObjectTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!hasRetainedFlag(object, root, 'retainSharedGeometry')) geometries.add(object.geometry);
    if (hasRetainedFlag(object, root, 'retainSharedMaterial')) return;
    const entries = Array.isArray(object.material) ? object.material : [object.material];
    entries.forEach((entry) => materials.add(entry));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((entry) => {
    Object.values(entry).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value); });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((entry) => entry.dispose());
}

function removeAndDispose(parent: THREE.Object3D, object: THREE.Object3D): void {
  parent.remove(object);
  disposeObjectTree(object);
}

function clearAndDispose(root: THREE.Object3D): void {
  root.children.slice().forEach((child) => removeAndDispose(root, child));
}
