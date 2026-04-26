import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { upgradeMaterial } from './lib.js';

// ── Config ─────────────────────────────────────────────────────────────────────
// Set in .env (VITE_ACNH_MODEL_ROOT); see .env.example
const ACNH_MODEL_ROOT = import.meta.env.VITE_ACNH_MODEL_ROOT;
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
  // @fs + absolute path (no extra slash) — /@fs//home/... is invalid and can confuse the dev server
  return `/@fs${encodeURI(`${ACNH_MODEL_ROOT}/${folderName}${SUFFIX}`)}`;
}

function fileUrl(folderName, fileName) {
  return `${folderUrl(folderName)}/${encodeURIComponent(fileName)}`;
}

/** `?debugFace=1` or `localStorage.setItem('DEBUG_ACNH_FACE','1')` → verbose face logs */
const FACE_DEBUG = (() => {
  try {
    return (
      new URLSearchParams(window.location.search).has('debugFace')
      || localStorage.getItem('DEBUG_ACNH_FACE') === '1'
    );
  } catch {
    return false;
  }
})();

function debugFace(...args) {
  if (FACE_DEBUG) console.log('[ACNH face]', ...args);
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
const skinColorInput = document.getElementById('skinColor');
const topSilhouetteEl = document.getElementById('topSilhouette');
const topTextureEl = document.getElementById('topTexture');
const bottomSilhouetteEl = document.getElementById('bottomSilhouette');
const bottomTextureEl = document.getElementById('bottomTexture');
const randomizeBtn = document.getElementById('randomizeBtn');
const randomizeLabel = randomizeBtn?.querySelector('.randomize-label');
const hatCategoryEl = document.getElementById('hatCategory');
const hatStyleEl = document.getElementById('hatStyle');
const shoesPickerEl = document.getElementById('shoesPicker');
const skinColorTrigger = document.getElementById('skinColorTrigger');
const hairColorTrigger = document.getElementById('hairColorTrigger');

/** Move hidden `<input type="color">` under the trigger so the OS picker opens there, not mid-screen. */
function placeColorInputBelowTrigger(input, trigger) {
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const iw = 40;
  const ih = 40;
  const gap = 8;
  // Conservative box for GTK/Chrome color dialogs so we can clamp to the viewport.
  const estPickerW = 400;
  const estPickerH = 340;

  let left = r.left + (r.width - iw) / 2;
  left = Math.min(left, vw - margin - estPickerW);
  left = Math.max(margin, left);

  let top = r.bottom + gap;
  if (top + estPickerH > vh - margin) {
    top = Math.max(margin, r.top - estPickerH - gap);
  }
  top = Math.min(top, vh - margin - ih);

  input.style.left = `${Math.round(left)}px`;
  input.style.top = `${Math.round(top)}px`;
  input.style.transform = 'none';
}

/** Open native color UI near the rainbow button; horizontal clamp keeps the right edge on-screen. */
function openAnchoredColorPicker(input, hex, trigger) {
  input.value = hex;
  placeColorInputBelowTrigger(input, trigger);
  try {
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }
  } catch {
    /* showPicker can throw if unsupported or blocked */
  }
  input.click();
}

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
let bodyTopWorldY = 0; // Head top in world space — used for hat vertical alignment

// Material references found after loading body
const matRefs = {
  skin: [],
  nose: [],
  hair: [],
  eye: [], // Body__mEye — ACNH decal shader (albedo + black-key alpha in fragment)
  mouth: [],
};

const state = {
  hairIndex: 18,
  eyeStyle: 0,
  eyeFrame: 0,
  mouthStyle: 0,
  mouthFrame: 0,
  skinColor: '#f5cba8', // matches 2nd face-panel swatch (choice 2)
  hairColor: '#5b3a1a',
};

// ── Texture helpers ────────────────────────────────────────────────────────────
function getCachedTexture(url, isColor, refTex) {
  if (!textureCache.has(url)) {
    const tex = textureLoader.load(
      url,
      () => {
        debugFace('texture ok', url.slice(-72));
      },
      undefined,
      (err) => {
        console.error('[ACNH] Texture load failed:', url, err);
      },
    );
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (refTex) {
      tex.flipY = refTex.flipY;
      tex.wrapS = refTex.wrapS;
      tex.wrapT = refTex.wrapT;
      tex.repeat.copy(refTex.repeat);
    }
    textureCache.set(url, tex);
  }
  return textureCache.get(url);
}

function setMaterialTextures(mat, albUrl, nrmUrl, mixUrl) {
  const refMap = mat.map;
  if (albUrl) mat.map = getCachedTexture(albUrl, true, refMap);
  // Face decals: same lighting as cheek/forehead — only albedo; ACNH Nrm/Mix are not PBR here.
  if (mat.userData?.acnhFaceDecal) {
    mat.normalMap = null;
    mat.roughnessMap = null;
    mat.metalnessMap = null;
    mat.needsUpdate = true;
    return;
  }
  if (mat.isMeshStandardMaterial) {
    const refNrm = mat.normalMap;
    const refMix = mat.roughnessMap;
    if (nrmUrl) mat.normalMap = getCachedTexture(nrmUrl, false, refNrm);
    if (mixUrl) mat.roughnessMap = getCachedTexture(mixUrl, false, refMix);
  }
  mat.needsUpdate = true;
}

/** ACNH skin/cheek maps are for Nintendo's skin shader, not MeshStandardMaterial. */
function stripAcnhSkinShaderTextures(mat) {
  mat.map = null;
  mat.normalMap = null;
  mat.roughnessMap = null;
  mat.metalnessMap = null;
  mat.roughness = 0.95;
  mat.metalness = 0;
  mat.needsUpdate = true;
}

/** ACNH stores mask data in vertex COLOR; Three.js multiplies it into the shade if enabled. */
function stripColladaVertexColorAttributes(model) {
  model.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    const g = child.geometry;
    if (g?.getAttribute('color')) {
      debugFace('strip vertex color attr:', child.name || '(no name)');
      g.deleteAttribute('color');
    }
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (mat) mat.vertexColors = false;
    }
  });
}

/**
 * Paint__mPaint uses mPaint_Alb — a Nintendo mask, not RGB skin. As a diffuse map it draws
 * black/white slabs across the forehead and mid-face in Three.js.
 */
function hideAcnhFacePaintMaskMesh(model) {
  let hidden = 0;
  model.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    const n = (child.name || '').toLowerCase();
    if (n.includes('mpaint') || (n.includes('paint') && n.includes('__'))) {
      child.visible = false;
      hidden += 1;
    }
  });
  if (hidden > 0) {
    console.info(
      `[ACNH] Hid ${hidden} face paint mesh(es) (e.g. Paint__mPaint). mPaint_Alb is a shader mask, not a PBR color map.`,
    );
  }
}

function snapMaterial(mat) {
  if (!mat) return null;
  const map = mat.map;
  let mapHint;
  if (map?.image) {
    const img = map.image;
    mapHint = {
      srcTail: typeof img.src === 'string' ? img.src.slice(-88) : '(no src)',
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
  } else {
    mapHint = map ? '(map set, no image yet)' : null;
  }
  return {
    type: mat.type,
    name: mat.name,
    isBasic: mat.isMeshBasicMaterial === true,
    isStandard: mat.isMeshStandardMaterial === true,
    vertexColors: mat.vertexColors,
    transparent: mat.transparent,
    opacity: mat.opacity,
    alphaTest: mat.alphaTest,
    depthWrite: mat.depthWrite,
    colorHex: mat.color?.getHexString?.(),
    roughness: mat.roughness,
    metalness: mat.metalness,
    hasMap: !!map,
    mapHint,
    hasNormalMap: !!mat.normalMap,
    hasRoughnessMap: !!mat.roughnessMap,
  };
}

/** When FACE_DEBUG: dump face-related meshes after material pipeline. */
function debugDumpFaceMeshes(model, phase) {
  if (!FACE_DEBUG || !model) return;
  const re = /(meye|mmouth|mcheek|mskin|mnose|paint|sock)/i;
  debugFace(`── mesh dump (${phase}) ──`);
  model.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    const n = child.name || '';
    if (!re.test(n)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    debugFace('mesh:', n, { isSkinnedMesh: child.isSkinnedMesh, matCount: mats.length });
    mats.forEach((mat, i) => {
      debugFace(`  [${i}]`, snapMaterial(mat));
    });
    const g = child.geometry;
    if (g?.attributes) {
      debugFace('  geometry attributes:', Object.keys(g.attributes));
    }
  });
}

// ── ACNH eye/mouth decals (custom map fragment on MeshBasicMaterial) ──────────
/** Collada mesh names: token `meye` but not `meyebrow`. */
function isAcnhEyeSlotMeshName(meshName) {
  const n = (meshName || '').toLowerCase();
  if (/(^|[^a-z])meyebrow([^a-z]|$)/i.test(n)) return false;
  return /(^|[^a-z])meye([^a-z]|$)/i.test(n);
}

function isAcnhMouthSlotMeshName(meshName) {
  const n = (meshName || '').toLowerCase();
  return /(^|[^a-z])mmouth([^a-z]|$)/i.test(n);
}

/**
 * Same map slot as cheek `color` + lighting: build albedo = mix(skin `diffuse`, atlas ink, keyed `a`).
 * Replaces Standard `map_fragment` (was `diffuseColor *= texture`) so “paper” becomes skin tint, ink stays.
 */
const ACNH_DECAL_STANDARD_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
	vec4 t = texture2D( map, vMapUv );
	float mx = max( max( t.r, t.g ), t.b );
	float mn = min( min( t.r, t.g ), t.b );
	float sat = mx - mn;
	float a = 0.0;
	if ( mx < 0.02745 ) {
		a = 0.0;
	} else if ( sat < 0.04706 && mx <= 0.20392 ) {
		a = 0.0;
	} else if ( mx < 0.12549 ) {
		a = clamp( ( mx - 0.02745 ) / ( 0.12549 - 0.02745 ), 0.0, 1.0 );
	} else {
		a = 1.0;
	}
	vec3 ink = t.rgb;
	vec3 skinTint = diffuse;
	vec3 albedo = mix( skinTint, ink, a );
	diffuseColor = vec4( albedo, opacity );
#endif
`.trim();

/** Lit like stripped `Body__mCheek` / `Body__mSkin` — MeshStandard + roughness only, custom albedo from atlas. */
function createAcnhDecalFaceMaterial(isSkinned) {
  const mat = new THREE.MeshStandardMaterial({
    name: 'AcnhFaceDecal',
    color: 0xffffff,
    side: THREE.DoubleSide,
    skinning: isSkinned,
    roughness: 0.95,
    metalness: 0,
    transparent: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  mat.userData.acnhFaceDecal = true;
  mat.customProgramCacheKey = () => 'acnh_decal_standard_cheekmatch_v1';
  mat.onBeforeCompile = (shader) => {
    const next = shader.fragmentShader.replace(
      '#include <map_fragment>',
      ACNH_DECAL_STANDARD_MAP_FRAGMENT,
    );
    if (next === shader.fragmentShader) {
      console.warn('[ACNH] Eye/mouth decal: #include <map_fragment> not found; shader patch skipped.');
    }
    shader.fragmentShader = next;
  };
  return mat;
}

/** After Standard upgrade: swap eye/mouth to decal shader; keep Collada albedo map ref only. */
function installAcnhFaceDecalMaterials(model) {
  model.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    const nm = child.name || '';
    if (!isAcnhEyeSlotMeshName(nm) && !isAcnhMouthSlotMeshName(nm)) return;

    const old = child.material;
    const list = Array.isArray(old) ? old : [old];
    const first = list[0];
    if (!first) return;

    let preservedMap = null;
    for (const m of list) {
      if (!m) continue;
      if (m.map && !preservedMap) preservedMap = m.map;
      m.map = null;
      m.normalMap = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
      m.dispose();
    }

    const decalMat = createAcnhDecalFaceMaterial(child.isSkinnedMesh);
    if (preservedMap) {
      preservedMap.colorSpace = THREE.SRGBColorSpace;
      preservedMap.generateMipmaps = false;
      preservedMap.minFilter = THREE.LinearFilter;
      preservedMap.magFilter = THREE.LinearFilter;
      decalMat.map = preservedMap;
    }
    child.material = decalMat;
  });
}

/**
 * Decal albedo comes from TextureLoader async — never set needsUpdate until `image` has pixels,
 * or Three warns: "Texture marked for update but no image data found."
 */
function configureDecalAlbedoTexture(tex, mat) {
  if (!tex) return;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const bump = () => {
    const img = tex.image;
    if (img?.naturalWidth > 0) {
      tex.needsUpdate = true;
      if (mat) mat.needsUpdate = true;
    }
  };
  bump();
  const img = tex.image;
  if (img?.naturalWidth > 0) return;
  if (img && typeof img.addEventListener === 'function') {
    img.addEventListener('load', bump, { once: true });
    img.addEventListener(
      'error',
      () => console.warn('[ACNH] Decal albedo image error (check path / VITE_ACNH_MODEL_ROOT).'),
      { once: true },
    );
  }
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
    const meshName = (child.name || '').toLowerCase();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (isAcnhEyeSlotMeshName(meshName)) {
        debugFace('collect: eye → decal refs', child.name, snapMaterial(mat));
        refs.eye.push(mat);
      } else if (isAcnhMouthSlotMeshName(meshName)) {
        debugFace('collect: mouth → decal refs', child.name, snapMaterial(mat));
        refs.mouth.push(mat);
      }
      else if (meshName.includes('mcheek') || meshName.includes('_mcheek')) {
        debugFace('collect: cheek → strip + skinRefs', child.name, snapMaterial(mat));
        stripAcnhSkinShaderTextures(mat);
        refs.skin.push(mat);
      }
      else if (meshName.includes('mnose') || meshName.includes('_mnose')) refs.nose.push(mat);
      else if (meshName.includes('mskin') || meshName.includes('_mskin') || meshName.includes('msocks') || meshName.includes('_msocks')) {
        // mSkin_Alb / mSkin_Mix are not literal PBR maps — using them as albedo + roughness
        // causes white streaks on the forehead and banding on the torso.
        if (meshName.includes('mskin') || meshName.includes('_mskin')) {
          debugFace('collect: skin → strip + skinRefs', child.name, snapMaterial(mat));
          stripAcnhSkinShaderTextures(mat);
        } else {
          debugFace('collect: socks → skinRefs (no strip)', child.name);
        }
        refs.skin.push(mat);
      }
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
    configureDecalAlbedoTexture(mat.map, mat);
    mat.needsUpdate = true;
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
    configureDecalAlbedoTexture(mat.map, mat);
    mat.needsUpdate = true;
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
  for (const mat of matRefs.eye) {
    mat.color.copy(color);
    mat.needsUpdate = true;
  }
  for (const mat of matRefs.mouth) {
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
  installAcnhFaceDecalMaterials(bodyModel);
  stripColladaVertexColorAttributes(bodyModel);
  hideAcnhFacePaintMaskMesh(bodyModel);
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
    `Body loaded — eye:${matRefs.eye.length} mouth:${matRefs.mouth.length} skin:${matRefs.skin.length} nose:${matRefs.nose.length}`,
  );
  debugDumpFaceMeshes(bodyModel, 'after collectMaterialRefs');
  console.info(
    '[ACNH] Face debug: ?debugFace=1 or localStorage.DEBUG_ACNH_FACE=1 then reload. Texture errors: [ACNH] Texture load failed. Face paint mask mesh is auto-hidden (see log above).',
    FACE_DEBUG ? '(verbose ON)' : '',
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
    stripColladaVertexColorAttributes(hairModel);

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
        if (!mat) continue;
        // mHair_Mix is not a PBR roughness map; it creates dark vertical bands in StandardMaterial.
        mat.roughnessMap = null;
        mat.roughness = 0.62;
        mat.needsUpdate = true;
        matRefs.hair.push(mat);
      }
    });

    applyHairColor();
    console.log(`Hair ${pad2(index)} loaded (${matRefs.hair.length} materials)`);
  } catch (err) {
    console.warn(`Failed to load hair ${pad2(index)}:`, err);
  }
}

// ── Populate pickers ───────────────────────────────────────────────────────────
function initSteppers() {
  document.querySelectorAll('[data-stepper]').forEach((wrap) => {
    const sel = wrap.querySelector('select');
    const prev = wrap.querySelector('[data-step-prev]');
    const next = wrap.querySelector('[data-step-next]');
    if (!sel || !prev || !next) return;
    const step = (delta) => {
      const n = sel.options.length;
      if (n <= 1) return;
      sel.selectedIndex = (sel.selectedIndex + delta + n) % n;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
  });
}

function normHex(c) {
  const s = (c || '').trim().toLowerCase();
  if (!s.startsWith('#')) return s;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s;
}

function syncSkinSwatchHighlight() {
  const v = normHex(skinColorInput.value);
  document.querySelectorAll('[data-skin]').forEach((btn) => {
    btn.classList.toggle('swatch--on', normHex(btn.getAttribute('data-skin')) === v);
  });
}

function syncHairSwatchHighlight() {
  const v = normHex(hairColor.value);
  document.querySelectorAll('[data-hair]').forEach((btn) => {
    btn.classList.toggle('swatch--on', normHex(btn.getAttribute('data-hair')) === v);
  });
}

function updatePreviewTags() {
  const el = document.getElementById('preview-tags');
  if (!el) return;
  const parts = [];
  if (topSilhouetteEl.value) {
    const shape = topSilhouetteEl.options[topSilhouetteEl.selectedIndex]?.text ?? '';
    const style =
      topTextureEl.value && topTextureEl.selectedIndex >= 0
        ? topTextureEl.options[topTextureEl.selectedIndex]?.text ?? ''
        : '';
    parts.push(style ? `${shape} - ${style}` : shape);
  }
  if (bottomSilhouetteEl.value) {
    const shape = bottomSilhouetteEl.options[bottomSilhouetteEl.selectedIndex]?.text ?? '';
    const style =
      bottomTextureEl.value && bottomTextureEl.selectedIndex >= 0
        ? bottomTextureEl.options[bottomTextureEl.selectedIndex]?.text ?? ''
        : '';
    parts.push(style ? `${shape} - ${style}` : shape);
  }
  if (hatCategoryEl.value && hatStyleEl.value) {
    parts.push(hatStyleEl.options[hatStyleEl.selectedIndex]?.text ?? '');
  }
  if (shoesPickerEl.value) {
    parts.push(shoesPickerEl.options[shoesPickerEl.selectedIndex]?.text ?? '');
  }
  el.replaceChildren(
    ...parts.map((t) => {
      const span = document.createElement('span');
      span.className = 'preview-tag';
      span.textContent = t.toUpperCase();
      return span;
    }),
  );
}

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
  syncHairSwatchHighlight();
  applyHairColor();
});

skinColorTrigger?.addEventListener('click', (e) => {
  e.preventDefault();
  openAnchoredColorPicker(skinColorInput, state.skinColor, skinColorTrigger);
});

hairColorTrigger?.addEventListener('click', (e) => {
  e.preventDefault();
  openAnchoredColorPicker(hairColor, state.hairColor, hairColorTrigger);
});

eyeStylePicker.addEventListener('change', () => {
  state.eyeStyle = Number(eyeStylePicker.value);
  applyEyeTextures();
});

eyeFrameSlider.addEventListener('input', () => {
  state.eyeFrame = Number(eyeFrameSlider.value);
  eyeFrameVal.textContent = pad2(state.eyeFrame);
  applyEyeTextures();
});

mouthStylePicker.addEventListener('change', () => {
  state.mouthStyle = Number(mouthStylePicker.value);
  applyMouthTextures();
});

mouthFrameSlider.addEventListener('input', () => {
  state.mouthFrame = Number(mouthFrameSlider.value);
  mouthFrameVal.textContent = pad2(state.mouthFrame);
  applyMouthTextures();
});

skinColorInput.addEventListener('input', () => {
  state.skinColor = skinColorInput.value;
  syncSkinSwatchHighlight();
  applySkinTint();
});

document.querySelectorAll('[data-skin]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const hex = btn.getAttribute('data-skin');
    if (!hex) return;
    skinColorInput.value = hex;
    state.skinColor = hex;
    syncSkinSwatchHighlight();
    applySkinTint();
  });
});

document.querySelectorAll('[data-hair]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const hex = btn.getAttribute('data-hair');
    if (!hex) return;
    hairColor.value = hex;
    state.hairColor = hex;
    syncHairSwatchHighlight();
    applyHairColor();
  });
});

// ── Clothing data ─────────────────────────────────────────────────────────────
const TOP_SILHOUETTES = [
  { mesh: 'PlayerTopsTopTshirtsN', label: 'T-Shirt', texPrefix: 'TopsTexTopTshirtsN' },
  { mesh: 'PlayerTopsTopTshirtsH', label: 'T-Shirt (short)', texPrefix: 'TopsTexTopTshirtsH' },
  { mesh: 'PlayerTopsTopTshirtsL', label: 'T-Shirt (long)', texPrefix: 'TopsTexTopTshirtsL' },
  { mesh: 'PlayerTopsTopYshirtsN', label: 'Y-Shirt', texPrefix: 'TopsTexTopYshirtsN' },
  { mesh: 'PlayerTopsTopYshirtsL', label: 'Y-Shirt (long)', texPrefix: 'TopsTexTopYshirtsL' },
  { mesh: 'PlayerTopsTopCoatL', label: 'Coat', texPrefix: 'TopsTexTopCoatL' },
  { mesh: 'PlayerTopsTopOuterL', label: 'Outer', texPrefix: 'TopsTexTopOuterL' },
  { mesh: 'PlayerTopsOnepieceAlineN', label: 'Dress A-Line', texPrefix: 'TopsTexOnepieceAlineN' },
  { mesh: 'PlayerTopsOnepieceBalloonN', label: 'Dress Balloon', texPrefix: 'TopsTexOnepieceBalloonN' },
  { mesh: 'PlayerTopsOnepieceBoxN', label: 'Dress Box', texPrefix: 'TopsTexOnepieceBoxN' },
  { mesh: 'PlayerTopsOnepieceOverallN', label: 'Overall', texPrefix: 'TopsTexOnepieceOverallN' },
  { mesh: 'PlayerTopsOnepieceRibN', label: 'Dress Rib', texPrefix: 'TopsTexOnepieceRibN' },
];

const BOTTOM_SILHOUETTES = [
  { mesh: 'PlayerBottomsPantsNormal', label: 'Pants', texPrefix: 'BottomsTexPantsNormal' },
  { mesh: 'PlayerBottomsPantsHalf', label: 'Shorts', texPrefix: 'BottomsTexPantsHalf' },
  { mesh: 'PlayerBottomsPantsHot', label: 'Hot Pants', texPrefix: 'BottomsTexPantsHot' },
  { mesh: 'PlayerBottomsPantsWide', label: 'Wide Pants', texPrefix: 'BottomsTexPantsWide' },
  { mesh: 'PlayerBottomsSkirtAline', label: 'Skirt A-Line', texPrefix: 'BottomsTexSkirtAline' },
  { mesh: 'PlayerBottomsSkirtBox', label: 'Skirt Box', texPrefix: 'BottomsTexSkirtBox' },
  { mesh: 'PlayerBottomsSkirtLong', label: 'Skirt Long', texPrefix: 'BottomsTexSkirtLong' },
];

/** Initial outfit (folder names without `.Nin_NX_NVN`; must exist under `VITE_ACNH_MODEL_ROOT`). */
const DEFAULT_OUTFIT = {
  topMesh: 'PlayerTopsTopCoatL',
  topTex: 'TopsTexTopCoatLRain1',
  bottomMesh: 'PlayerBottomsPantsWide',
  bottomTex: 'BottomsTexPantsWideRain1',
  shoesFolder: 'ShoesHighcutMouton3',
};

let clothingTextureLists = {};
let topModel = null;
let bottomModel = null;
let hatModel = null;
let shoesModel = null;

const HAT_CATEGORIES = [
  { prefix: 'CapHat', label: 'Hat' },
  { prefix: 'CapBangs', label: 'Hat (with bangs)' },
  { prefix: 'CapHelmet', label: 'Helmet' },
  { prefix: 'CapCostume', label: 'Costume' },
  { prefix: 'CapFullface', label: 'Full Face' },
  { prefix: 'CapMask', label: 'Mask' },
  { prefix: 'CapOrnament', label: 'Ornament' },
  { prefix: 'CapWig', label: 'Wig' },
];

async function scanClothingTextures(texPrefix) {
  if (clothingTextureLists[texPrefix]) return clothingTextureLists[texPrefix];
  try {
    const resp = await fetch(`/api/scan-folders?prefix=${encodeURIComponent(texPrefix)}`);
    if (!resp.ok) { clothingTextureLists[texPrefix] = []; return []; }
    const folders = await resp.json();
    clothingTextureLists[texPrefix] = folders;
    return folders;
  } catch {
    clothingTextureLists[texPrefix] = [];
    return [];
  }
}

function populateTextureDropdown(selectEl, items, labelPrefix) {
  selectEl.innerHTML = '';
  if (items.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '—';
    selectEl.append(opt);
    return;
  }
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item;
    const name = item.replace(labelPrefix, '').replace(/(\d+)$/, ' $1');
    opt.textContent = name || item;
    selectEl.append(opt);
  }
}

async function loadClothingModel(daeFolder, texFolder) {
  const daeUrl = fileUrl(daeFolder, `${daeFolder}.dae`);
  const resolvedTexFolder = texFolder || daeFolder;
  const collada = await new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      let normalized = url;
      try { normalized = decodeURIComponent(url); } catch (_) { /* keep original */ }
      normalized = normalized.replace(/\\/g, '/');
      const base = normalized.split('/').pop();
      if (!base) return url;
      if (base.toLowerCase().endsWith('.dae')) return fileUrl(daeFolder, base);
      return fileUrl(resolvedTexFolder, base);
    });
    const loader = new ColladaLoader(manager);
    loader.load(daeUrl, resolve, undefined, reject);
  });
  const model = collada.scene;
  prepareModelMaterialsCustom(model);
  return model;
}

function disposeModel(model) {
  if (!model) return;
  model.traverse((child) => {
    if (child.isMesh || child.isSkinnedMesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => { if (m) m.dispose(); });
    }
  });
}

async function loadTop(silIdx, texFolder) {
  if (topModel) {
    playerGroup.remove(topModel);
    disposeModel(topModel);
    topModel = null;
  }
  if (silIdx < 0 || !texFolder) return;
  const sil = TOP_SILHOUETTES[silIdx];
  try {
    topModel = await loadClothingModel(sil.mesh, texFolder);
    playerGroup.add(topModel);
    topModel.updateMatrixWorld(true);
  } catch (err) {
    console.warn('Failed to load top:', err);
  }
}

async function loadBottom(silIdx, texFolder) {
  if (bottomModel) {
    playerGroup.remove(bottomModel);
    disposeModel(bottomModel);
    bottomModel = null;
  }
  if (silIdx < 0 || !texFolder) return;
  const sil = BOTTOM_SILHOUETTES[silIdx];
  try {
    bottomModel = await loadClothingModel(sil.mesh, texFolder);
    playerGroup.add(bottomModel);
    bottomModel.updateMatrixWorld(true);
  } catch (err) {
    console.warn('Failed to load bottom:', err);
  }
}

async function loadShoes(folder) {
  if (shoesModel) {
    playerGroup.remove(shoesModel);
    disposeModel(shoesModel);
    shoesModel = null;
  }
  if (!folder) return;
  try {
    shoesModel = await loadClothingModel(folder, folder);
    playerGroup.add(shoesModel);
    shoesModel.updateMatrixWorld(true);
  } catch (err) {
    console.warn('Failed to load shoes:', err);
  }
}

async function loadHat(folder) {
  if (hatModel) {
    playerGroup.remove(hatModel);
    disposeModel(hatModel);
    hatModel = null;
  }
  if (!folder) return;
  try {
    hatModel = await loadClothingModel(folder, folder);
    playerGroup.add(hatModel);

    if (headBone) {
      playerGroup.updateMatrixWorld(true);
      const headWorldPos = new THREE.Vector3();
      headBone.getWorldPosition(headWorldPos);
      let hatRootBone = null;
      hatModel.traverse((child) => {
        if (child.isBone && child.name === 'Root') hatRootBone = child;
      });
      if (hatRootBone) {
        const hatRootWorldPos = new THREE.Vector3();
        hatRootBone.getWorldPosition(hatRootWorldPos);
        hatModel.position.add(headWorldPos.clone().sub(hatRootWorldPos));
      }

      // CapHat models sit ON TOP of the head; other categories (Bangs, Helmet, etc.) envelope it
      if (folder.startsWith('CapHat') && bodyTopWorldY > 0) {
        const headHeight = bodyTopWorldY - headWorldPos.y;
        hatModel.position.y += headHeight * 0.60;
      }
    }

    hatModel.updateMatrixWorld(true);
  } catch (err) {
    console.warn('Failed to load hat:', err);
  }
}

// ── Clothing pickers ──────────────────────────────────────────────────────────
function populateClothingPickers() {
  for (const [i, sil] of TOP_SILHOUETTES.entries()) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = sil.label;
    topSilhouetteEl.append(opt);
  }
  for (const [i, sil] of BOTTOM_SILHOUETTES.entries()) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = sil.label;
    bottomSilhouetteEl.append(opt);
  }
}

function appendShoesPickerOption(folderName) {
  if ([...shoesPickerEl.options].some((o) => o.value === folderName)) return;
  const opt = document.createElement('option');
  opt.value = folderName;
  opt.textContent = folderName.replace(/^Shoes/, '').replace(/(\d+)$/, ' $1');
  shoesPickerEl.append(opt);
}

async function populateShoesPicker() {
  try {
    const resp = await fetch('/api/scan-folders?prefix=Shoes');
    if (!resp.ok) return;
    const all = await resp.json();
    const seen = new Set();
    for (const name of all) {
      if (seen.size >= 60) break;
      if (seen.has(name)) continue;
      seen.add(name);
      appendShoesPickerOption(name);
    }
    // Picker is capped; always allow the default load-out folder if scan order skipped it.
    appendShoesPickerOption(DEFAULT_OUTFIT.shoesFolder);
  } catch (err) {
    console.warn('Failed to populate shoes picker:', err);
  }
}

async function applyDefaultOutfit() {
  const topIdx = TOP_SILHOUETTES.findIndex((s) => s.mesh === DEFAULT_OUTFIT.topMesh);
  const botIdx = BOTTOM_SILHOUETTES.findIndex((s) => s.mesh === DEFAULT_OUTFIT.bottomMesh);
  if (topIdx < 0 || botIdx < 0) {
    console.warn('[ACNH] Default outfit: silhouette not found');
    return;
  }

  topSilhouetteEl.value = String(topIdx);
  const topSil = TOP_SILHOUETTES[topIdx];
  const topTexes = await scanClothingTextures(topSil.texPrefix);
  populateTextureDropdown(topTextureEl, topTexes, topSil.texPrefix);
  if (topTexes.includes(DEFAULT_OUTFIT.topTex)) {
    topTextureEl.value = DEFAULT_OUTFIT.topTex;
    await loadTop(topIdx, DEFAULT_OUTFIT.topTex);
  } else {
    console.warn('[ACNH] Default top texture missing:', DEFAULT_OUTFIT.topTex);
  }

  bottomSilhouetteEl.value = String(botIdx);
  const botSil = BOTTOM_SILHOUETTES[botIdx];
  const botTexes = await scanClothingTextures(botSil.texPrefix);
  populateTextureDropdown(bottomTextureEl, botTexes, botSil.texPrefix);
  if (botTexes.includes(DEFAULT_OUTFIT.bottomTex)) {
    bottomTextureEl.value = DEFAULT_OUTFIT.bottomTex;
    await loadBottom(botIdx, DEFAULT_OUTFIT.bottomTex);
  } else {
    console.warn('[ACNH] Default bottom texture missing:', DEFAULT_OUTFIT.bottomTex);
  }

  appendShoesPickerOption(DEFAULT_OUTFIT.shoesFolder);
  shoesPickerEl.value = DEFAULT_OUTFIT.shoesFolder;
  await loadShoes(DEFAULT_OUTFIT.shoesFolder);

  updatePreviewTags();
}

function populateHatCategories() {
  for (const cat of HAT_CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = cat.prefix;
    opt.textContent = cat.label;
    hatCategoryEl.append(opt);
  }
}

hatCategoryEl.addEventListener('change', async () => {
  const prefix = hatCategoryEl.value;
  hatStyleEl.innerHTML = '<option value="">—</option>';
  try {
    if (!prefix) {
      if (hatModel) { playerGroup.remove(hatModel); disposeModel(hatModel); hatModel = null; }
      return;
    }
    const resp = await fetch(`/api/scan-folders?prefix=${encodeURIComponent(prefix)}`);
    if (!resp.ok) return;
    const folders = await resp.json();
    for (const name of folders) {
      if (name.includes('UnderWater') || name.includes('Preview')) continue;
      const opt = document.createElement('option');
      opt.value = name;
      const label = name.replace(prefix, '').replace(/(\d+)$/, ' $1');
      opt.textContent = label || name;
      hatStyleEl.append(opt);
    }
    if (folders.length > 0) {
      const first = folders.find((n) => !n.includes('UnderWater') && !n.includes('Preview'));
      if (first) {
        hatStyleEl.value = first;
        await loadHat(first);
      }
    }
  } catch (err) {
    console.warn('Failed to populate hat styles:', err);
  } finally {
    updatePreviewTags();
  }
});

hatStyleEl.addEventListener('change', async () => {
  await loadHat(hatStyleEl.value || null);
  updatePreviewTags();
});

topSilhouetteEl.addEventListener('change', async () => {
  try {
    const val = topSilhouetteEl.value;
    if (!val) {
      topTextureEl.innerHTML = '<option value="">—</option>';
      if (topModel) { playerGroup.remove(topModel); disposeModel(topModel); topModel = null; }
      return;
    }
    const sil = TOP_SILHOUETTES[Number(val)];
    const textures = await scanClothingTextures(sil.texPrefix);
    populateTextureDropdown(topTextureEl, textures, sil.texPrefix);
    if (textures.length > 0) {
      await loadTop(Number(val), textures[0]);
    }
  } finally {
    updatePreviewTags();
  }
});

topTextureEl.addEventListener('change', async () => {
  const silVal = topSilhouetteEl.value;
  const texVal = topTextureEl.value;
  if (!silVal || !texVal) return;
  await loadTop(Number(silVal), texVal);
  updatePreviewTags();
});

bottomSilhouetteEl.addEventListener('change', async () => {
  try {
    const val = bottomSilhouetteEl.value;
    if (!val) {
      bottomTextureEl.innerHTML = '<option value="">—</option>';
      if (bottomModel) { playerGroup.remove(bottomModel); disposeModel(bottomModel); bottomModel = null; }
      return;
    }
    const sil = BOTTOM_SILHOUETTES[Number(val)];
    const textures = await scanClothingTextures(sil.texPrefix);
    populateTextureDropdown(bottomTextureEl, textures, sil.texPrefix);
    if (textures.length > 0) {
      await loadBottom(Number(val), textures[0]);
    }
  } finally {
    updatePreviewTags();
  }
});

bottomTextureEl.addEventListener('change', async () => {
  const silVal = bottomSilhouetteEl.value;
  const texVal = bottomTextureEl.value;
  if (!silVal || !texVal) return;
  await loadBottom(Number(silVal), texVal);
  updatePreviewTags();
});

shoesPickerEl.addEventListener('change', async () => {
  await loadShoes(shoesPickerEl.value || null);
  updatePreviewTags();
});

// ── Randomizer ────────────────────────────────────────────────────────────────
function pickRandom(selectEl) {
  const opts = [...selectEl.options].filter((o) => o.value !== '');
  if (opts.length === 0) return null;
  const pick = opts[Math.floor(Math.random() * opts.length)];
  selectEl.value = pick.value;
  return pick.value;
}

randomizeBtn.addEventListener('click', async () => {
  randomizeBtn.disabled = true;
  if (randomizeLabel) randomizeLabel.textContent = 'Randomizing…';

  try {
    // Top — pick silhouette then load its textures and pick one
    const topIdx = pickRandom(topSilhouetteEl);
    let topPromise = Promise.resolve();
    if (topIdx) {
      const sil = TOP_SILHOUETTES[Number(topIdx)];
      const textures = await scanClothingTextures(sil.texPrefix);
      populateTextureDropdown(topTextureEl, textures, sil.texPrefix);
      if (textures.length > 0) {
        const tex = textures[Math.floor(Math.random() * textures.length)];
        topTextureEl.value = tex;
        topPromise = loadTop(Number(topIdx), tex);
      }
    }

    // Bottom
    const botIdx = pickRandom(bottomSilhouetteEl);
    let bottomPromise = Promise.resolve();
    if (botIdx) {
      const sil = BOTTOM_SILHOUETTES[Number(botIdx)];
      const textures = await scanClothingTextures(sil.texPrefix);
      populateTextureDropdown(bottomTextureEl, textures, sil.texPrefix);
      if (textures.length > 0) {
        const tex = textures[Math.floor(Math.random() * textures.length)];
        bottomTextureEl.value = tex;
        bottomPromise = loadBottom(Number(botIdx), tex);
      }
    }

    // Hat — pick category, populate styles, pick one
    pickRandom(hatCategoryEl);
    let hatPromise = Promise.resolve();
    if (hatCategoryEl.value) {
      const prefix = hatCategoryEl.value;
      const resp = await fetch(`/api/scan-folders?prefix=${encodeURIComponent(prefix)}`);
      if (resp.ok) {
        const folders = await resp.json();
        hatStyleEl.innerHTML = '<option value="">—</option>';
        for (const name of folders) {
          if (name.includes('UnderWater') || name.includes('Preview')) continue;
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name.replace(prefix, '').replace(/(\d+)$/, ' $1') || name;
          hatStyleEl.append(opt);
        }
        pickRandom(hatStyleEl);
        if (hatStyleEl.value) hatPromise = loadHat(hatStyleEl.value);
      }
    }

    // Shoes
    pickRandom(shoesPickerEl);
    const shoesPromise = shoesPickerEl.value ? loadShoes(shoesPickerEl.value) : Promise.resolve();

    await Promise.all([topPromise, bottomPromise, hatPromise, shoesPromise]);
    updatePreviewTags();
  } finally {
    randomizeBtn.disabled = false;
    if (randomizeLabel) randomizeLabel.textContent = 'Randomize';
  }
});

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  populatePickers();
  hairPicker.value = String(state.hairIndex);

  loadingEl.classList.remove('hidden');
  loadingEl.querySelector('p').textContent = 'Loading player body…';

  try {
    await loadBody();

    loadingEl.querySelector('p').textContent = 'Loading hair…';
    await loadHair(state.hairIndex);

    // Apply initial customization
    applyEyeTextures();
    applyMouthTextures();
    applySkinTint();

    debugFace('matRefs snapshot:', {
      eye: matRefs.eye.map(snapMaterial),
      mouth: matRefs.mouth.map(snapMaterial),
      skinCount: matRefs.skin.length,
      noseCount: matRefs.nose.length,
    });
    debugDumpFaceMeshes(bodyModel, 'after applyEye/Mouth/SkinTint');

    if (FACE_DEBUG) {
      setTimeout(() => {
        debugDumpFaceMeshes(bodyModel, 'after 1.5s');
      }, 1500);
    }

    fitCameraToGroup();

    // Compute head-top Y for hat vertical alignment
    playerGroup.updateMatrixWorld(true);
    bodyModel.traverse((child) => {
      if ((child.isMesh || child.isSkinnedMesh) && child.geometry) {
        child.geometry.computeBoundingBox();
        if (child.geometry.boundingBox) {
          const geoBox = child.geometry.boundingBox.clone();
          geoBox.applyMatrix4(child.matrixWorld);
          bodyTopWorldY = Math.max(bodyTopWorldY, geoBox.max.y);
        }
      }
    });

    populateClothingPickers();
    populateHatCategories();
    await populateShoesPicker();
    await applyDefaultOutfit();

    initSteppers();
    syncSkinSwatchHighlight();
    syncHairSwatchHighlight();
    updatePreviewTags();

    loadingEl.classList.add('hidden');
    statusNote.textContent = 'Ready — customize away!';
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
