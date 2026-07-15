import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUTPUT = resolve('public/assets/models');
const TAU = Math.PI * 2;

function boxGeometry() {
  const faces = [
    [[0, 0, 1], [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]],
    [[0, 0,-1], [[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]],
    [[1, 0, 0], [[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]],
    [[-1,0, 0], [[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]],
    [[0, 1, 0], [[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]],
    [[0,-1, 0], [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]],
  ];
  const positions = []; const normals = []; const indices = [];
  faces.forEach(([normal, verts], face) => {
    verts.forEach((v) => { positions.push(...v); normals.push(...normal); });
    const n = face * 4; indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
  });
  return { positions, normals, indices };
}

function cylinderGeometry(segments = 16, topRadius = .5) {
  const positions = []; const normals = []; const indices = [];
  for (let i = 0; i < segments; i += 1) {
    const a = i / segments * TAU; const x = Math.cos(a); const z = Math.sin(a);
    positions.push(x * .5, -.5, z * .5, x * topRadius, .5, z * topRadius);
    normals.push(x, 0, z, x, 0, z);
  }
  for (let i = 0; i < segments; i += 1) { const n = i * 2; const next = (i + 1) % segments * 2; indices.push(n, next, n + 1, next, next + 1, n + 1); }
  const bottomCenter = positions.length / 3; positions.push(0, -.5, 0); normals.push(0, -1, 0);
  const topCenter = positions.length / 3; positions.push(0, .5, 0); normals.push(0, 1, 0);
  for (let i = 0; i < segments; i += 1) {
    const a = i / segments * TAU; const x = Math.cos(a); const z = Math.sin(a);
    positions.push(x * .5, -.5, z * .5); normals.push(0, -1, 0);
    positions.push(x * topRadius, .5, z * topRadius); normals.push(0, 1, 0);
  }
  const rim = topCenter + 1;
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    indices.push(bottomCenter, rim + next * 2, rim + i * 2);
    indices.push(topCenter, rim + i * 2 + 1, rim + next * 2 + 1);
  }
  return { positions, normals, indices };
}

function quatZ(angle) { return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]; }
function rgba(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1]; }

class GlbBuilder {
  constructor(name) {
    this.name = name; this.parts = []; this.bufferViews = []; this.accessors = []; this.meshes = []; this.nodes = []; this.materials = [];
    this.meshCache = new Map(); this.geometries = { box: boxGeometry(), cyl8: cylinderGeometry(8), cyl16: cylinderGeometry(16), cone8: cylinderGeometry(8, 0) };
  }
  material(name, color, emissive = 0, metallic = .72, roughness = .28) {
    const item = { name, pbrMetallicRoughness: { baseColorFactor: rgba(color), metallicFactor: metallic, roughnessFactor: roughness } };
    if (emissive) { item.emissiveFactor = rgba(emissive).slice(0, 3); item.extensions = { KHR_materials_emissive_strength: { emissiveStrength: 2.4 } }; }
    this.materials.push(item); return this.materials.length - 1;
  }
  addBytes(typed, target) {
    const padding = (4 - (this.parts.reduce((n, part) => n + part.length, 0) % 4)) % 4;
    if (padding) this.parts.push(Buffer.alloc(padding));
    const offset = this.parts.reduce((n, part) => n + part.length, 0);
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength); this.parts.push(bytes);
    this.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    return this.bufferViews.length - 1;
  }
  accessor(typed, componentType, type, target, min, max) {
    const bufferView = this.addBytes(typed, target); const components = type === 'SCALAR' ? 1 : 3;
    const accessor = { bufferView, componentType, count: typed.length / components, type };
    if (min) accessor.min = min; if (max) accessor.max = max;
    this.accessors.push(accessor); return this.accessors.length - 1;
  }
  mesh(geometryKey, material) {
    const key = `${geometryKey}:${material}`; if (this.meshCache.has(key)) return this.meshCache.get(key);
    const geometry = this.geometries[geometryKey];
    const position = this.accessor(new Float32Array(geometry.positions), 5126, 'VEC3', 34962, [-.5,-.5,-.5], [.5,.5,.5]);
    const normal = this.accessor(new Float32Array(geometry.normals), 5126, 'VEC3', 34962);
    const indexArray = geometry.positions.length / 3 > 255 ? new Uint16Array(geometry.indices) : new Uint16Array(geometry.indices);
    const indices = this.accessor(indexArray, 5123, 'SCALAR', 34963);
    this.meshes.push({ name: `${geometryKey}-${material}`, primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, material }] });
    const id = this.meshes.length - 1; this.meshCache.set(key, id); return id;
  }
  node(name, geometry, material, translation, scale, children, rotation) {
    const node = { name };
    if (geometry) node.mesh = this.mesh(geometry, material);
    if (translation) node.translation = translation; if (scale) node.scale = scale;
    if (children?.length) node.children = children; if (rotation) node.rotation = rotation;
    this.nodes.push(node); return this.nodes.length - 1;
  }
  async write(filename, roots, extras) {
    const bin = Buffer.concat(this.parts); const paddedBin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
    const gltf = {
      asset: { version: '2.0', generator: 'Cyber Tank self-developed deterministic GLB pipeline' },
      extensionsUsed: ['KHR_materials_emissive_strength'], scene: 0, scenes: [{ name: this.name, nodes: roots }],
      nodes: this.nodes, meshes: this.meshes, materials: this.materials, accessors: this.accessors, bufferViews: this.bufferViews,
      buffers: [{ byteLength: paddedBin.length }], extras: { copyright: 'Cyber Tank original asset', ...extras },
    };
    let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + paddedBin.length, 8);
    const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(paddedBin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
    await writeFile(resolve(OUTPUT, filename), Buffer.concat([header, jsonHeader, json, binHeader, paddedBin]));
  }
}

async function tank(filename, detail) {
  const b = new GlbBuilder(`Cyber Tank ${detail}`);
  const yellow = b.material('Sunrise alloy', 0xffc928, 0xffb300, .76, .22);
  const dark = b.material('Carbon tracks', 0x101926, 0x08121c, .86, .38);
  const cyan = b.material('Cyan energy', 0x75f7ff, 0x22dfff, .42, .16);
  const glass = b.material('Sensor glass', 0xcafcff, 0x38e8ff, .25, .08);
  const body = [
    b.node('LOWER_CHASSIS', 'box', dark, [0,.34,0], [1.62,.42,1.92]),
    b.node('ARMORED_BODY', 'box', yellow, [0,.68,.04], [1.34,.46,1.58]),
    b.node('ENERGY_REAR', 'box', cyan, [0,.68,.84], [.68,.19,.1]),
  ];
  const wheelCount = detail === 'high' ? 3 : detail === 'balanced' ? 2 : 0;
  if (wheelCount) for (const x of [-.92,.92]) for (let i = 0; i < wheelCount; i += 1) {
    const z = wheelCount === 3 ? -.64 + i * .64 : -.5 + i;
    body.push(b.node(`WHEEL_${x}_${i}`, detail === 'high' ? 'cyl16' : 'cyl8', dark, [x,.34,z], [.4,.3,.4], undefined, quatZ(Math.PI / 2)));
    body.push(b.node(`HUB_${x}_${i}`, 'cyl8', cyan, [x + Math.sign(x) * .16,.34,z], [.2,.33,.2], undefined, quatZ(Math.PI / 2)));
  } else {
    body.push(b.node('LEFT_TRACK', 'box', dark, [-.9,.32,0], [.36,.42,1.78]), b.node('RIGHT_TRACK', 'box', dark, [.9,.32,0], [.36,.42,1.78]));
  }
  if (detail === 'high') {
    body.push(b.node('LEFT_NEON_RAIL', 'box', cyan, [-.71,.72,-.03], [.08,.12,1.26]));
    body.push(b.node('RIGHT_NEON_RAIL', 'box', cyan, [.71,.72,-.03], [.08,.12,1.26]));
    body.push(b.node('FRONT_SENSOR', 'box', glass, [0,.83,-.78], [.58,.16,.08]));
  }
  const turretChildren = [
    b.node('TURRET_DOME', detail === 'low' ? 'cyl8' : 'cyl16', dark, [0,.22,0], [1.02,.34,1.02]),
    b.node('ENERGY_BARREL', 'box', cyan, [0,.29,-.76], [.2,.2,1.5]),
    b.node('MUZZLE', 'box', yellow, [0,.29,-1.51], [.34,.34,.28]),
  ];
  if (detail === 'high') turretChildren.push(b.node('AIM_SENSOR', 'cyl8', glass, [.42,.38,-.08], [.18,.28,.18]));
  const turret = b.node('CYBER_TURRET', undefined, undefined, [0,.73,0], undefined, turretChildren);
  const root = b.node('CYBER_TANK_ROOT', undefined, undefined, undefined, undefined, [...body, turret]);
  await b.write(filename, [root], { lod: detail, assetFamily: 'player-tank', units: 'meters' });
}

async function boss(filename, detail) {
  const b = new GlbBuilder(`Region Boss ${detail}`);
  const armor = b.material('Boss armor', 0x472654, 0xb52cff, .82, .27);
  const core = b.material('Boss core', 0xff5e91, 0xff1e69, .48, .12);
  const cyan = b.material('Captured energy', 0x78f7ff, 0x20dfff, .4, .14);
  const count = detail === 'high' ? 12 : detail === 'balanced' ? 8 : 4;
  const children = [
    b.node('BOSS_CORE_BODY', detail === 'low' ? 'cyl8' : 'cyl16', armor, [0,1.45,0], [2.8,1.9,2.8]),
    b.node('BOSS_HEART', detail === 'high' ? 'cyl16' : 'cyl8', core, [0,1.48,-1.38], [.78,.5,.34], undefined, quatZ(Math.PI / 2)),
    b.node('LEFT_WING', 'box', armor, [-2.05,1.5,.15], [1.7,.3,1]),
    b.node('RIGHT_WING', 'box', armor, [2.05,1.5,.15], [1.7,.3,1]),
  ];
  for (let i = 0; i < count; i += 1) {
    const a = i / count * TAU; children.push(b.node(`ENERGY_CROWN_${i}`, 'cone8', i % 2 ? cyan : core, [Math.cos(a)*1.72,2.18,Math.sin(a)*1.72], [.28,.82,.28]));
  }
  const root = b.node('REGION_BOSS_ROOT', undefined, undefined, undefined, undefined, children);
  await b.write(filename, [root], { lod: detail, assetFamily: 'region-boss', units: 'meters' });
}

async function beacon() {
  const b = new GlbBuilder('Star Beacon');
  const base = b.material('Beacon base', 0x17283a, 0x0c1e31, .8, .32);
  const light = b.material('Star light', 0xffdc55, 0xffc928, .3, .12);
  const cyan = b.material('Signal rings', 0x63f5ff, 0x24dfff, .34, .14);
  const root = b.node('STAR_BEACON_ROOT', undefined, undefined, undefined, undefined, [
    b.node('BASE', 'cyl16', base, [0,.22,0], [1.5,.44,1.5]),
    b.node('TOWER', 'box', base, [0,1.2,0], [.4,1.7,.4]),
    b.node('STAR_CORE', 'cyl16', light, [0,2.15,0], [.72,.72,.72]),
    b.node('SIGNAL', 'cyl16', cyan, [0,2.15,0], [1.35,.08,1.35]),
  ]);
  await b.write('star-beacon.glb', [root], { lod: 'balanced', assetFamily: 'workshop-prop', units: 'meters' });
}

await mkdir(dirname(resolve(OUTPUT, 'asset.glb')), { recursive: true });
await Promise.all([
  tank('cyber-tank-high.glb', 'high'), tank('cyber-tank-balanced.glb', 'balanced'), tank('cyber-tank-low.glb', 'low'),
  boss('region-boss-high.glb', 'high'), boss('region-boss-balanced.glb', 'balanced'), boss('region-boss-low.glb', 'low'), beacon(),
]);
console.log('Cyber Tank original GLB assets generated.');
