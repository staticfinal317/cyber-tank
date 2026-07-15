import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { RenderQuality } from '../platform/PerformanceGovernor';

export type ModelSlot = 'player-tank' | 'enemy-boss' | 'workshop-prop';

export interface ModelAssetSpec {
  url: string;
  lod?: Partial<Record<RenderQuality, string>>;
  scale?: number;
  offset?: [number, number, number];
  rotationY?: number;
}

type AssetCatalog = Partial<Record<ModelSlot, ModelAssetSpec>>;

export function resolveModelUrl(spec: ModelAssetSpec, quality: RenderQuality): string {
  return spec.lod?.[quality] ?? spec.lod?.balanced ?? spec.url;
}

/** Cached, optional glTF source. Missing assets never block the procedural fallback. */
export class ModelAssetLibrary {
  private readonly loader = new GLTFLoader();
  private readonly specs = new Map<ModelSlot, ModelAssetSpec>();
  private readonly cache = new Map<string, Promise<THREE.Group | undefined>>();
  private catalogReady: Promise<void> = Promise.resolve();
  private quality: RenderQuality = 'balanced';
  private revision = 0;

  loadCatalog(url = '/assets/models/catalog.json'): Promise<void> {
    this.catalogReady = this.fetchCatalog(url);
    return this.catalogReady;
  }

  private async fetchCatalog(url: string): Promise<void> {
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
  setQuality(quality: RenderQuality): boolean {
    if (quality === this.quality) return false;
    this.quality = quality;
    this.revision += 1;
    return true;
  }

  getQuality(): RenderQuality { return this.quality; }

  async instantiate(slot: ModelSlot): Promise<THREE.Group | undefined> {
    await this.catalogReady;
    const spec = this.specs.get(slot); if (!spec) return undefined;
    const requestRevision = this.revision;
    const requestedQuality = this.quality;
    const url = resolveModelUrl(spec, requestedQuality);
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.loader.loadAsync(url).then((gltf) => gltf.scene).catch(() => undefined);
      this.cache.set(url, pending);
    }
    const source = await pending;
    // A completed high-LOD request must never overwrite a newer battery-mode
    // request. Callers can simply retry after a quality transition.
    if (!source || requestRevision !== this.revision || requestedQuality !== this.quality) return undefined;
    const model = source.clone(true);
    // Geometry remains shared with the catalog cache, while materials are cloned
    // per instance so paint, emissive lights and cloaking can be changed safely.
    model.userData.retainSharedGeometry = true;
    model.userData.assetQuality = requestedQuality;
    model.scale.setScalar(spec.scale ?? 1);
    if (spec.offset) model.position.set(...spec.offset);
    model.rotation.y = spec.rotationY ?? 0;
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = Array.isArray(child.material)
        ? child.material.map((entry) => entry.clone())
        : child.material.clone();
      child.castShadow = true; child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((entry) => {
        if (entry instanceof THREE.MeshStandardMaterial) entry.envMapIntensity = 1.15;
      });
    });
    return model;
  }
}
