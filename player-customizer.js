import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { upgradeMaterial } from './lib.js';

// ── Config ─────────────────────────────────────────────────────────────────────
const ACNH_MODEL_ROOT =
  'C:/Users/ZUHAIR/Desktop/2026/animalcrossing/ACNH_2.0.0_Exported_Model_DAE+PNG/Model';
const SUFFIX = '.Nin_NX_NVN';

const HAIR_COUNT = 48;   // PlayerHair00 … PlayerHair47
const EYE_COUNT = 26;    // PlayerEye00 … PlayerEye25
const MOUTH_COUNT = 4;   // PlayerMouth00 … PlayerMouth03
const EYE_FRAMES = 16;   // 0–15
const MOUTH_FRAMES = 9;  // 0–8

function pad2(n) {
  return String(n).padStart(2, '0');
}

function folderUrl(folderName) {
  return `/@fs/${encodeURI(`${ACNH_MODEL_ROOT}/${folderName}${SUFFIX}`)}`;
}

function fileUrl(folderName, fileName) {
  return `${folderUrl(folderName)}/${encodeURIComponent(fileName)}`;
}

// ── DOM refs ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('viewer');
const loadingEl = document.getElementById('loading');
const statusNote = document.getElementById('status-note');
const hairPicker = document.getElementById('hairPicker');
const hairColor = document.getElementById('hairColor');
const eyeStylePicker = document.getElementById('eyeStylePicker');
const eyeFrameSlider = document.getElementById('eyeFrame');
const eyeFrameVal = document.getElementById('eyeFrameVal');
const mouthStylePicker = document.getElementById('mouthStylePicker');
const mouthFrameSlider = document.getElementById('mouthFrame');
const mouthFrameVal = document.getElementById('mouthFrameVal');
const cheekPicker = document.getElementById('cheekPicker');
const skinColorInput = document.getElementById('skinColor');

// ── Three.js setup ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
const bgColor = new THREE.Color(0x0a0812);
scene.background = bgColor;
scene.fog = new THREE.Fog(bgColor, 30, 180);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 8, 16);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 50;
controls.target.set(0, 4, 0);
controls.update();

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.6);
keyLight.position.set(5, 10, 8);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xc4e0ff, 0.7);
fillLight.position.set(-5, 5, -4);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
rimLight.position.set(0, 6, -8);
scene.add(rimLight);
scene.add(new THREE.HemisphereLight(0x87ceeb, 0x362d59, 0.5));

const gridHelper = new THREE.GridHelper(30, 60, 0x333355, 0x222244);
gridHelper.position.y = -0.01;
scene.add(gridHelper);

// ── State ──────────────────────────────────────────────────────────────────────
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const playerGroup = new THREE.Group();
playerGroup.name = 'PlayerCharacter';
scene.add(playerGroup);

let bodyModel = null;
let hairModel = null;
let headBone = null; // Body's Head bone — hair attaches here

// Material references found after loading body
const matRefs = {
  eye: [],    // materials named mEye
  mouth: [],  // materials named mMouth
  cheek: [],  // materials named mCheek
  skin: [],   // materials named mSkin
  nose: [],   // materials named mNose
  hair: [],   // materials from hair model
};

const state = {
  hairIndex: 0,
  eyeStyle: 0,
  eyeFrame: 0,
  mouthStyle: 0,
  mouthFrame: 0,
  cheekIndex: 0,
  skinColor: '#fdd5b1',
  hairColor: '#5b3a1a',
};

// ── Texture helpers ────────────────────────────────────────────────────────────
function getCachedTexture(url, isColor, refTex) {
  if (!textureCache.has(url)) {
    const tex = textureLoader.load(url);
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (refTex) {
      tex.flipY = refTex.flipY;
      tex.wrapS = refTex.wrapS;
      tex.wrapT = refTex.wrapT;
      tex.repeat.copy(refTex.repeat);
    } else {
      // COLLADA models use flipY=false; when there's no reference texture
      // (e.g. eye/mouth textures that don't exist in the PlayerBody folder)
      // we must set this explicitly or the texture renders in the wrong place.
      tex.flipY = false;
    }
    textureCache.set(url, tex);
  }
  return textureCache.get(url);
}

function setMaterialTextures(mat, albUrl, nrmUrl, mixUrl) {
  const refMap = mat.map;
  const refNrm = mat.normalMap;
  const refMix = mat.roughnessMap;
  if (albUrl) mat.map = getCachedTexture(albUrl, true, refMap);
  if (nrmUrl) mat.normalMap = getCachedTexture(nrmUrl, false, refNrm);
  if (mixUrl) mat.roughnessMap = getCachedTexture(mixUrl, false, refMix);
  mat.needsUpdate = true;
}

// ── Model loading ──────────────────────────────────────────────────────────────
function prepareModelMaterialsCustom(model) {
  let count = 0;
  model.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    count++;
    child.frustumCulled = false;
    if (Array.isArray(child.material)) {
      child.material = child.material.map((m) => upgradeMaterial(m, child.isSkinnedMesh));
    } else {
      child.material = upgradeMaterial(child.material, child.isSkinnedMesh);
    }
    if (child.isSkinnedMesh && child.skeleton) {
      child.skeleton.update();
    }
  });
  return count;
}

function collectMaterialRefs(model, refs) {
  model.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      const n = (mat.name || '').toLowerCase();
      if (n === 'meye') refs.eye.push(mat);
      else if (n === 'mmouth') refs.mouth.push(mat);
      else if (n === 'mcheek') refs.cheek.push(mat);
      else if (n === 'mskin') refs.skin.push(mat);
      else if (n === 'mnose') refs.nose.push(mat);
    }
  });
}

function loadColladaWithTextures(daeUrl, baseFolder) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      let normalized = url;
      try { normalized = decodeURIComponent(url); } catch (_) { /* keep original */ }
      normalized = normalized.replace(/\\/g, '/');
      const base = normalized.split('/').pop();
      if (!base) return url;
      // Redirect to the correct folder via /@fs/
      return fileUrl(baseFolder, base);
    });
    const loader = new ColladaLoader(manager);
    loader.load(daeUrl, resolve, undefined, reject);
  });
}

function fitCameraToGroup() {
  playerGroup.updateMatrixWorld(true);
  const box = new THREE.Box3();
  playerGroup.traverse((child) => {
    if ((child.isMesh || child.isSkinnedMesh) && child.geometry) {
      child.geometry.computeBoundingBox();
      if (child.geometry.boundingBox) {
        const geoBox = child.geometry.boundingBox.clone();
        geoBox.applyMatrix4(child.matrixWorld);
        box.union(geoBox);
      }
    }
  });
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const height = size.y;
  const fov = camera.fov * (Math.PI / 180);
  let dist = Math.max(0.1, sphere.radius) / Math.sin(fov / 2);
  dist *= 1.15;

  playerGroup.position.x -= center.x;
  playerGroup.position.y -= box.min.y;
  playerGroup.position.z -= center.z;
  playerGroup.updateMatrixWorld(true);

  const lookY = height * 0.42;
  camera.position.set(0, lookY + height * 0.26, dist);
  controls.target.set(0, lookY, 0);
  camera.updateProjectionMatrix();
  controls.update();
}

// ── Customization apply functions ──────────────────────────────────────────────
function applyEyeTextures() {
  const folder = `PlayerEye${pad2(state.eyeStyle)}`;
  const frame = state.eyeFrame;
  for (const mat of matRefs.eye) {
    setMaterialTextures(
      mat,
      fileUrl(folder, `mEye_Alb.${frame}.png`),
      fileUrl(folder, `mEye_Nrm.${frame}.png`),
      fileUrl(folder, `mEye_Mix.${frame}.png`),
    );
  }
}

function applyMouthTextures() {
  const folder = `PlayerMouth${pad2(state.mouthStyle)}`;
  const frame = state.mouthFrame;
  for (const mat of matRefs.mouth) {
    setMaterialTextures(
      mat,
      fileUrl(folder, `mMouth_Alb.${frame}.png`),
      fileUrl(folder, `mMouth_Nrm.${frame}.png`),
      fileUrl(folder, `mMouth_Mix.${frame}.png`),
    );
  }
}

function applyCheekTexture() {
  const idx = state.cheekIndex;
  for (const mat of matRefs.cheek) {
    setMaterialTextures(
      mat,
      fileUrl('PlayerBody', `mCheek_Alb.${idx}.png`),
      null,
      null,
    );
  }
}

function applySkinTint() {
  const color = new THREE.Color(state.skinColor);
  for (const mat of matRefs.skin) {
    mat.color.copy(color);
    mat.needsUpdate = true;
  }
  for (const mat of matRefs.nose) {
    mat.color.copy(color);
    mat.needsUpdate = true;
  }
  for (const mat of matRefs.cheek) {
    mat.color.copy(color);
    mat.needsUpdate = true;
  }
}

function applyHairColor() {
  const color = new THREE.Color(state.hairColor);
  for (const mat of matRefs.hair) {
    mat.color.copy(color);
    mat.needsUpdate = true;
  }
}

// ── Load body ──────────────────────────────────────────────────────────────────
async function loadBody() {
  const daeUrl = fileUrl('PlayerBody', 'PlayerBody.dae');
  const collada = await loadColladaWithTextures(daeUrl, 'PlayerBody');
  bodyModel = collada.scene;
  playerGroup.add(bodyModel);
  bodyModel.updateMatrixWorld(true);
  prepareModelMaterialsCustom(bodyModel);
  collectMaterialRefs(bodyModel, matRefs);

  // Find the Head bone so we can attach hair to it
  headBone = null;
  bodyModel.traverse((child) => {
    if (child.isBone && child.name === 'Head') {
      headBone = child;
    }
  });
  if (headBone) {
    console.log('Found Head bone for hair attachment');
  } else {
    console.warn('Head bone not found — hair will not be positioned correctly');
  }

  console.log(
    `Body loaded — eye:${matRefs.eye.length} mouth:${matRefs.mouth.length} cheek:${matRefs.cheek.length} skin:${matRefs.skin.length}`,
  );
}

// ── Load hair ──────────────────────────────────────────────────────────────────
async function loadHair(index) {
  // Remove old hair
  if (hairModel) {
    playerGroup.remove(hairModel);
    hairModel.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => { if (m) m.dispose(); });
      }
    });
    hairModel = null;
    matRefs.hair = [];
  }

  const folder = `PlayerHair${pad2(index)}`;
  const daeUrl = fileUrl(folder, `${folder}.dae`);

  try {
    const collada = await loadColladaWithTextures(daeUrl, folder);
    hairModel = collada.scene;
    prepareModelMaterialsCustom(hairModel);

    playerGroup.add(hairModel);

    if (headBone) {
      playerGroup.updateMatrixWorld(true);

      const headWorldPos = new THREE.Vector3();
      headBone.getWorldPosition(headWorldPos);

      let hairRootBone = null;
      hairModel.traverse((child) => {
        if (child.isBone && child.name === 'Root') hairRootBone = child;
      });

      if (hairRootBone) {
        const hairRootWorldPos = new THREE.Vector3();
        hairRootBone.getWorldPosition(hairRootWorldPos);
        hairModel.position.add(headWorldPos.sub(hairRootWorldPos));
      }
    }

    hairModel.updateMatrixWorld(true);

    // Collect hair materials
    hairModel.traverse((child) => {
      if (!child.isMesh && !child.isSkinnedMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat) matRefs.hair.push(mat);
      }
    });

    applyHairColor();
    console.log(`Hair ${pad2(index)} loaded (${matRefs.hair.length} materials)`);
  } catch (err) {
    console.warn(`Failed to load hair ${pad2(index)}:`, err);
  }
}

// ── Populate pickers ───────────────────────────────────────────────────────────
function populatePickers() {
  for (let i = 0; i < HAIR_COUNT; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Style ${pad2(i)}`;
    hairPicker.append(opt);
  }

  for (let i = 0; i < EYE_COUNT; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Style ${pad2(i)}`;
    eyeStylePicker.append(opt);
  }

  for (let i = 0; i < MOUTH_COUNT; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Style ${pad2(i)}`;
    mouthStylePicker.append(opt);
  }
}

// ── Wire up events ─────────────────────────────────────────────────────────────
hairPicker.addEventListener('change', async () => {
  state.hairIndex = Number(hairPicker.value);
  await loadHair(state.hairIndex);
});

hairColor.addEventListener('input', () => {
  state.hairColor = hairColor.value;
  applyHairColor();
});

eyeStylePicker.addEventListener('change', () => {
  state.eyeStyle = Number(eyeStylePicker.value);
  applyEyeTextures();
});

eyeFrameSlider.addEventListener('input', () => {
  state.eyeFrame = Number(eyeFrameSlider.value);
  eyeFrameVal.textContent = state.eyeFrame;
  applyEyeTextures();
});

mouthStylePicker.addEventListener('change', () => {
  state.mouthStyle = Number(mouthStylePicker.value);
  applyMouthTextures();
});

mouthFrameSlider.addEventListener('input', () => {
  state.mouthFrame = Number(mouthFrameSlider.value);
  mouthFrameVal.textContent = state.mouthFrame;
  applyMouthTextures();
});

cheekPicker.addEventListener('change', () => {
  state.cheekIndex = Number(cheekPicker.value);
  applyCheekTexture();
});

skinColorInput.addEventListener('input', () => {
  state.skinColor = skinColorInput.value;
  applySkinTint();
});

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  populatePickers();

  loadingEl.classList.remove('hidden');
  loadingEl.querySelector('p').textContent = 'Loading player body…';

  try {
    await loadBody();

    loadingEl.querySelector('p').textContent = 'Loading hair…';
    await loadHair(state.hairIndex);

    // Apply initial customization
    applyEyeTextures();
    applyMouthTextures();
    applyCheekTexture();
    applySkinTint();

    fitCameraToGroup();
    loadingEl.classList.add('hidden');
    statusNote.textContent = 'Body + hair loaded. Customize away!';
    console.log('Player customizer ready');
  } catch (err) {
    console.error('Failed to load player model:', err);
    loadingEl.querySelector('p').textContent = 'Failed to load player model. Is Vite dev server running?';
    const spinner = loadingEl.querySelector('.spinner');
    if (spinner) spinner.style.display = 'none';
    statusNote.textContent = 'Error — check console.';
  }
}

void init();

// ── Render loop ────────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
