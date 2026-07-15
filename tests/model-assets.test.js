import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readGlb(name) {
  const data = readFileSync(resolve('public/assets/models', name));
  expect(data.subarray(0, 4).toString()).toBe('glTF');
  expect(data.readUInt32LE(4)).toBe(2);
  expect(data.readUInt32LE(8)).toBe(data.length);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString().trim());
  return { json, size: data.length };
}

describe('self-developed glTF/PBR model pipeline', () => {
  it('generates valid compact GLB containers with traceable metadata', () => {
    for (const file of ['cyber-tank-high.glb', 'cyber-tank-balanced.glb', 'cyber-tank-low.glb', 'region-boss-high.glb', 'star-beacon.glb']) {
      const { json, size } = readGlb(file);
      expect(json.asset.generator).toContain('self-developed');
      expect(size).toBeLessThan(80_000);
      expect(json.materials.every((material) => material.pbrMetallicRoughness)).toBe(true);
    }
  });

  it('keeps the independently aimed turret node in every tank LOD', () => {
    for (const file of ['cyber-tank-high.glb', 'cyber-tank-balanced.glb', 'cyber-tank-low.glb']) {
      const { json } = readGlb(file);
      expect(json.nodes.some((node) => node.name === 'CYBER_TURRET')).toBe(true);
    }
  });
});
