import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type ModelSlot = 'player-tank' | 'enemy-boss' | 'workshop-prop';

export interface ModelAssetSpec {
  url: string;
  scale?: number;
  offset?: [number, number, number];
  rotationY?: number;
}

type AssetCatalog = Partial<Record<ModelSlot, ModelAssetSpec>>;

/** Cached, optional glTF source. Missing assets never block the procedural fallback. */
export class ModelAssetLibrary {
  private readonly loader = new GLTFLoader();
  private readonly specs = new Map<ModelSlot, ModelAssetSpec>();
  private readonly cache = new Map<string, Promise<THREE.Group | undefined>>();

  async loadCatalog(url = '/assets/models/catalog.json'): Promise<void> {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) return;
      const catalog = await response.json() as AssetCatalog;
      (Object.entries(catalog) as Array<[ModelSlot, ModelAssetSpec]>).forEach(([slot, spec]) => {
        if (spec?.url) this.register(slot, spec);
      });
    } catch { /* Offline and first-run builds keep procedural geometry. */ }
  }

  register(slot: ModelSlot, spec: ModelAssetSpec): void { this.specs.set(slot, spec); }

  async instantiate(slot: ModelSlot): Promise<THREE.Group | undefined> {
    const spec = this.specs.get(slot); if (!spec) return undefined;
    let pending = this.cache.get(spec.url);
    if (!pending) {
      pending = this.loader.loadAsync(spec.url).then((gltf) => gltf.scene).catch(() => undefined);
      this.cache.set(spec.url, pending);
    }
    const source = await pending; if (!source) return undefined;
    const model = source.clone(true);
    model.scale.setScalar(spec.scale ?? 1);
    if (spec.offset) model.position.set(...spec.offset);
    model.rotation.y = spec.rotationY ?? 0;
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true; child.receiveShadow = true;
      if (child.material instanceof THREE.MeshStandardMaterial) child.material.envMapIntensity = 1.15;
    });
    return model;
  }
}
