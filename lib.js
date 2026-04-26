// ── Shared utilities for model loading & material upgrade ─────────────────────
import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';

const loader = new ColladaLoader();

export function upgradeMaterial(oldMat, isSkinned = false) {
  const matName = oldMat?.name || '';

  const newMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  newMat.name = matName;

  // Transfer diffuse / albedo map
  if (oldMat.map) {
    newMat.map = oldMat.map;
    newMat.map.colorSpace = THREE.SRGBColorSpace;
  }

  // Transfer normal map
  if (oldMat.normalMap) {
    newMat.normalMap = oldMat.normalMap;
    newMat.normalScale = new THREE.Vector2(0.8, 0.8);
  }

  // Transfer specular → roughness
  if (oldMat.specularMap) {
    newMat.roughnessMap = oldMat.specularMap;
    newMat.roughness = 0.65;
    newMat.metalness = 0.1;
  }

  // Required for SkinnedMesh. Without this flag, skinned characters can appear invisible.
  newMat.skinning = isSkinned;

  // Handle transparency
  if (oldMat.transparent || matName.includes('Alpha') || matName.includes('Glass')) {
    newMat.transparent = true;
    newMat.alphaTest = 0.05;
    newMat.depthWrite = true;
    if (oldMat.opacity !== undefined && oldMat.opacity < 1) {
      newMat.opacity = oldMat.opacity;
    }
  }

  return newMat;
}

export function prepareModelMaterials(model) {
  let meshCount = 0;
  model.traverse((child) => {
    if (child.isMesh || child.isSkinnedMesh) {
      meshCount += 1;
      child.frustumCulled = false;
      if (Array.isArray(child.material)) {
        child.material = child.material.map((mat) => upgradeMaterial(mat, child.isSkinnedMesh));
      } else {
        child.material = upgradeMaterial(child.material, child.isSkinnedMesh);
      }
      if (child.isSkinnedMesh && child.skeleton) {
        child.skeleton.update();
      }
    }
  });
  return meshCount;
}

export function loadColladaAsync(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}
