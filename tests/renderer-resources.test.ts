import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObjectTree } from '../src/render/ThreeRenderer';

describe('renderer resource lifecycle', () => {
  it('disposes each owned geometry and material exactly once', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    let geometryDisposals = 0; let materialDisposals = 0;
    geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    material.addEventListener('dispose', () => { materialDisposals += 1; });

    disposeObjectTree(root);

    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);
  });

  it('keeps shared cached asset resources alive', () => {
    const root = new THREE.Group(); const cachedModel = new THREE.Group();
    cachedModel.userData.retainSharedResources = true;
    const geometry = new THREE.BoxGeometry(); const material = new THREE.MeshBasicMaterial();
    cachedModel.add(new THREE.Mesh(geometry, material)); root.add(cachedModel);
    let disposals = 0; geometry.addEventListener('dispose', () => { disposals += 1; });

    disposeObjectTree(root);

    expect(disposals).toBe(0);
  });

  it('retains cached geometry but disposes cloned instance materials', () => {
    const root = new THREE.Group();
    root.userData.retainSharedGeometry = true;
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    root.add(new THREE.Mesh(geometry, material));
    let geometryDisposals = 0; let materialDisposals = 0;
    geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    material.addEventListener('dispose', () => { materialDisposals += 1; });

    disposeObjectTree(root);

    expect(geometryDisposals).toBe(0);
    expect(materialDisposals).toBe(1);
  });
});
