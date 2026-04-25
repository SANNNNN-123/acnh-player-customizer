// ── Shared utilities for model loading & material upgrade ─────────────────────
import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';

const loader = new ColladaLoader();

function debugFaceLib(...args) {
  try {
    if (typeof window === 'undefined') return;
    if (
      new URLSearchParams(window.location.search).has('debugFace')
      || localStorage.getItem('DEBUG_ACNH_FACE') === '1'
    ) {
      console.log('[ACNH face/lib]', ...args);
    }
  } catch {
    /* ignore */
  }
}

export function upgradeMaterial(oldMat, isSkinned = false) {
  const matName = oldMat?.name || '';

  // Eyes / mouth: ACNH *_Mix / normals are not PBR; StandardMaterial + lights yields black slabs
  // and wrong alpha. Unlit basic + alpha cutout matches decal-style rendering.
  if (matName.includes('Eye') || matName.includes('Mouth')) {
    debugFaceLib('upgrade → MeshBasicMaterial', {
      matName,
      skinnedMesh: isSkinned,
      hadMap: !!oldMat.map,
      oldType: oldMat.type,
    });
    const basic = new THREE.MeshBasicMaterial({
      name: matName,
      color: 0xffffff,
      side: THREE.DoubleSide,
      skinning: isSkinned,
      transparent: true,
      alphaTest: 0.08,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    if (oldMat.map) {
      basic.map = oldMat.map;
      basic.map.colorSpace = THREE.SRGBColorSpace;
    }
    if (oldMat.opacity !== undefined && oldMat.opacity < 1) {
      basic.opacity = oldMat.opacity;
    }
    return basic;
  }

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
