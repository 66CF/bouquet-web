import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const EASE = {
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

/* 简单的补间管理器 */
const activeTweens = new Set();

function tween(obj, prop, to, duration, ease = EASE.inOutCubic, onComplete = null) {
  const t = {
    obj,
    prop,
    from: obj[prop],
    to,
    duration: Math.max(0.001, duration),
    elapsed: 0,
    ease,
    onComplete,
    alive: true,
  };
  activeTweens.add(t);
  return t;
}

function killTweens() {
  for (const t of activeTweens) t.alive = false;
  activeTweens.clear();
}

function updateTweens(dt) {
  for (const t of activeTweens) {
    if (!t.alive) continue;
    t.elapsed += dt;
    const p = Math.min(1, t.elapsed / t.duration);
    t.obj[t.prop] = THREE.MathUtils.lerp(t.from, t.to, t.ease(p));
    if (p >= 1) {
      t.alive = false;
      activeTweens.delete(t);
      if (t.onComplete) t.onComplete();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 渲染器 / 场景 / 相机                                               */
/* ------------------------------------------------------------------ */

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = null; // 透明背景，由 CSS 弥散光氛围层呈现
scene.fog = new THREE.FogExp2(0x141034, 0.014);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 0.9, 5.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;
controls.minDistance = 0.8;
controls.maxDistance = 24;

/* 环境光 + 灯光（用于原始模型） */
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environmentIntensity = 0.65;
}
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x443322, 0.6));
{
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(3.2, 4.5, 2.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
  fill.position.set(-3, 1.5, -2.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xff88cc, 0.65);
  rim.position.set(-1, 2.5, -4.5);
  scene.add(rim);
}

/* 后期：Bloom 发光 */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.05,
  0.8,
  0.32
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ */
/* 粒子着色器                                                         */
/* ------------------------------------------------------------------ */

const particleVertexShader = /* glsl */ `
  attribute vec3 aHome;
  attribute vec3 aText;
  attribute vec3 aRadial;
  attribute vec3 aRandDir;
  attribute vec3 aColor;
  attribute float aRand;
  attribute float aSize;

  uniform float uTime;
  uniform float uSpread;
  uniform float uSpreadMode;
  uniform float uSpreadDist;
  uniform float uMorph;
  uniform float uParticleOpacity;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uScaleFactor;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float r1 = fract(aRand * 7.13);
    float r2 = fract(aRand * 3.71);

    // 爆炸 / 散射：每个粒子有随机延迟，运动更自然
    float delay = r1 * 0.30;
    float e = smoothstep(delay, 1.0, uSpread);
    vec3 dir = mix(aRadial, aRandDir, step(0.5, uSpreadMode));
    float dist = uSpreadDist * (0.25 + 0.75 * r2) * (1.0 - 0.25 * uSpreadMode);
    // 花束形状 与 字母形状 之间渐变
    vec3 base = mix(aHome, aText, uMorph);
    vec3 pos = base + dir * dist * e;

    // 轻微漂浮，让云层有呼吸感
    pos.x += sin(uTime * 0.6 + aRand * 6.2831) * 0.004;
    pos.y += cos(uTime * 0.45 + r1 * 6.2831) * 0.004;
    pos.z += sin(uTime * 0.5 + r2 * 6.2831) * 0.004;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.70 + 0.30 * sin(uTime * (1.0 + r1 * 3.0) + r2 * 6.2831);
    vAlpha = uParticleOpacity * twinkle;
    vColor = aColor;

    // 爆炸/散射过程中粒子略微放大，保证散开后仍有光点存在感
    float size = aSize * uSizeScale * (1.0 + 0.8 * uSpread);
    gl_PointSize = size * uPixelRatio * uScaleFactor / max(0.1, -mv.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 24.0);
  }
`;

const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a = a * a;                    // 柔和光斑
    vec3 col = vColor * (0.8 + 0.45 * a);  // 中心微亮，整体柔和
    gl_FragColor = vec4(col * a * vAlpha, a * vAlpha);
  }
`;

const particleMaterial = new THREE.ShaderMaterial({
  vertexShader: particleVertexShader,
  fragmentShader: particleFragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uSpread: { value: 0 },
    uSpreadMode: { value: 0 },
    uSpreadDist: { value: 2.2 },
    uMorph: { value: 0 },
    uParticleOpacity: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    uSizeScale: { value: 1.0 },
    uScaleFactor: { value: 1000 },
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

/* ------------------------------------------------------------------ */
/* 模型与粒子数据                                                     */
/* ------------------------------------------------------------------ */

const MODEL_URL = './assets/flower_bouquet.glb';

const state = {
  meshOpacity: 1,
  particleOpacity: 0,
  spread: 0,
  morph: 0, // 0 = 花束形状，1 = 字母 ZWC 形状
  spreadMode: 0, // 0 = 爆炸方向（径向），1 = 散射（随机方向）
};

let modelRoot = null;
let particleSystem = null;
let particleGeo = null;
let totalVerts = 0;
let activeParticles = 0;
let modelMaterials = [];

// 全量粒子数据（按原始顶点顺序）
const full = {
  home: null,
  text: null,
  color: null,
  radial: null,
  randDir: null,
  rand: null,
  size: null,
};

const textureCache = new Map();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpUv = new THREE.Vector2();

function getTextureData(texture) {
  if (textureCache.has(texture.uuid)) return textureCache.get(texture.uuid);
  const img = texture.image;
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const td = { data, w: c.width, h: c.height };
  textureCache.set(texture.uuid, td);
  return td;
}

function sampleColor(texture, u, v, fallback) {
  if (!texture) return fallback;
  const td = getTextureData(texture);
  if (!td) return fallback;
  const x = Math.floor((((u % 1) + 1) % 1) * (td.w - 1));
  const y = Math.floor((((v % 1) + 1) % 1) * (td.h - 1));
  const i = (y * td.w + x) * 4;
  return [
    srgbToLinear(td.data[i] / 255),
    srgbToLinear(td.data[i + 1] / 255),
    srgbToLinear(td.data[i + 2] / 255),
  ];
}

/* 用 Canvas 把 "zwc" 渲染成点阵，生成粒子拼字的目标位置 */
function buildTextTargets(count) {
  const W = 900;
  const H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 250px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('zwc', W / 2, H / 2);
  const data = ctx.getImageData(0, 0, W, H).data;

  const pts = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 128) pts.push(x, y);
    }
  }
  const nPts = pts.length / 2;
  if (nPts < 32) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  const scale = Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // 洗牌，让粒子拼字时不会出现扫描线轨迹
  const order = new Uint32Array(nPts);
  for (let i = 0; i < nPts; i++) order[i] = i;
  const rand = mulberry32(20260807);
  for (let i = nPts - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const oi = order[i % nPts] * 2;
    const nx = (pts[oi] - cx) / scale;
    const ny = (pts[oi + 1] - cy) / scale;
    out[i * 3] = nx + (rand() - 0.5) * 0.02;
    out[i * 3 + 1] = -ny + (rand() - 0.5) * 0.02; // canvas y 向下，翻转
    out[i * 3 + 2] = (rand() - 0.5) * 0.035;      // 轻微厚度
  }
  return out;
}

function onModelLoaded(gltf) {
  modelRoot = gltf.scene;
  scene.add(modelRoot);
  modelRoot.updateMatrixWorld(true);

  // 第一遍：把每个网格的顶点变换到世界空间，记录位置 / 颜色 / 随机量
  const positions = [];
  const colors = [];
  const randoms = [];
  const sizes = [];
  const bbox = new THREE.Box3();

  modelRoot.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
    const geo = obj.geometry;
    const posAttr = geo.attributes.position;
    if (!posAttr) return;
    const uvAttr = geo.attributes.uv;
    const count = posAttr.count;

    const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const map = material && material.map ? material.map : null;
    const fallbackColor = material && material.color
      ? [material.color.r, material.color.g, material.color.b]
      : [0.9, 0.85, 0.95];

    if (material && !modelMaterials.includes(material)) modelMaterials.push(material);

    obj.updateWorldMatrix(true, false);
    const m = obj.matrixWorld;

    for (let i = 0; i < count; i++) {
      tmpVec.fromBufferAttribute(posAttr, i).applyMatrix4(m);
      positions.push(tmpVec.x, tmpVec.y, tmpVec.z);
      bbox.expandByPoint(tmpVec);

      if (uvAttr) {
        tmpUv.fromBufferAttribute(uvAttr, i);
      } else {
        tmpUv.set(0, 0);
      }
      const [r, g, b] = sampleColor(map, tmpUv.x, tmpUv.y, fallbackColor);
      colors.push(r, g, b);
    }
  });

  totalVerts = positions.length / 3;
  if (totalVerts === 0) {
    showLoadError('模型中未找到可渲染的网格');
    return;
  }

  // 把模型居中到原点，粒子坐标同样减去中心
  const center = bbox.getCenter(new THREE.Vector3());
  modelRoot.position.sub(center);
  const size = bbox.getSize(new THREE.Vector3());

  full.home = new Float32Array(totalVerts * 3);
  full.color = new Float32Array(totalVerts * 3);
  full.radial = new Float32Array(totalVerts * 3);
  full.randDir = new Float32Array(totalVerts * 3);
  full.rand = new Float32Array(totalVerts);
  full.size = new Float32Array(totalVerts);
  full.text = new Float32Array(totalVerts * 3);

  const centerY = center.y;
  // 字母 "zwc" 的目标点阵（相对模型尺寸缩放）
  const textTargets = buildTextTargets(totalVerts);
  const textScale = size.length() * 0.55;
  for (let i = 0; i < totalVerts; i++) {
    const i3 = i * 3;
    const x = positions[i3] - center.x;
    const y = positions[i3 + 1] - center.y;
    const z = positions[i3 + 2] - center.z;

    full.home[i3] = x;
    full.home[i3 + 1] = y;
    full.home[i3 + 2] = z;

    full.color[i3] = colors[i3];
    full.color[i3 + 1] = colors[i3 + 1];
    full.color[i3 + 2] = colors[i3 + 2];

    // 爆炸方向：从花束中心向外；位置太靠近中心时退化为随机方向
    const len = Math.sqrt(x * x + y * y + z * z);
    const rand = mulberry32(i + 7);
    const r1 = rand();
    const r2 = rand();
    const r3 = rand();

    if (len > 1e-5) {
      full.radial[i3] = x / len;
      full.radial[i3 + 1] = y / len;
      full.radial[i3 + 2] = z / len;
    } else {
      full.radial[i3] = r1 * 2 - 1;
      full.radial[i3 + 1] = r2 * 2 - 1;
      full.radial[i3 + 2] = r3 * 2 - 1;
      const l = Math.hypot(full.radial[i3], full.radial[i3 + 1], full.radial[i3 + 2]);
      full.radial[i3] /= l;
      full.radial[i3 + 1] /= l;
      full.radial[i3 + 2] /= l;
    }

    let dx = r1 * 2 - 1;
    let dy = r2 * 2 - 1;
    let dz = r3 * 2 - 1;
    const dl = Math.hypot(dx, dy, dz) || 1;
    full.randDir[i3] = dx / dl;
    full.randDir[i3 + 1] = dy / dl;
    full.randDir[i3 + 2] = dz / dl;

    full.rand[i] = rand();
    // 粒子大小相对模型尺寸缩放，避免叠加过亮
    full.size[i] = size.y * (0.005 + r1 * 0.006);

    if (textTargets) {
      full.text[i3] = textTargets[i3] * textScale;
      full.text[i3 + 1] = textTargets[i3 + 1] * textScale;
      full.text[i3 + 2] = textTargets[i3 + 2] * textScale;
    }
  }

  // 粒子系统
  particleGeo = new THREE.BufferGeometry();
  particleSystem = new THREE.Points(particleGeo, particleMaterial);
  particleSystem.frustumCulled = false;
  scene.add(particleSystem);

  applyParticleCount(parseInt($('particleCount').value, 10));
  prepareMaterials();
  frameCamera(size, centerY);
  setupUI();
  hideLoading();
  // 初始选中“原始模型”，滑块停在第一个选项
  setActiveButton('original');
}

function frameCamera(size, centerY) {
  const radius = size.length() * 0.5;
  const dist = radius * 2.6;
  camera.near = Math.max(0.05, dist / 80);
  camera.far = Math.max(200, dist * 8);
  camera.updateProjectionMatrix();
  camera.position.set(0, size.y * 0.24, dist);
  controls.target.set(0, 0, 0);
  controls.update();
}

/* 原始模型材质：开启透明，供溶解动画使用 */
function prepareMaterials() {
  modelMaterials.forEach((m, i) => {
    m.transparent = true;
    m.userData.baseOpacity = m.opacity == null ? 1 : m.opacity;
    m.userData.dissolveOffset = (i / Math.max(1, modelMaterials.length - 1)) * 0.32;
  });
}

/* ------------------------------------------------------------------ */
/* 粒子数量                                                           */
/* ------------------------------------------------------------------ */

function applyParticleCount(targetCount) {
  if (!particleGeo || !full.home) return;
  const stride = Math.max(1, Math.round(totalVerts / targetCount));
  const n = Math.floor(totalVerts / stride);
  if (n < 2) return;

  const home = new Float32Array(n * 3);
  const text = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const radial = new Float32Array(n * 3);
  const randDir = new Float32Array(n * 3);
  const rand = new Float32Array(n);
  const size = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const s = i * stride;
    const s3 = s * 3;
    const i3 = i * 3;
    home[i3] = full.home[s3];
    home[i3 + 1] = full.home[s3 + 1];
    home[i3 + 2] = full.home[s3 + 2];
    text[i3] = full.text[s3];
    text[i3 + 1] = full.text[s3 + 1];
    text[i3 + 2] = full.text[s3 + 2];
    color[i3] = full.color[s3];
    color[i3 + 1] = full.color[s3 + 1];
    color[i3 + 2] = full.color[s3 + 2];
    radial[i3] = full.radial[s3];
    radial[i3 + 1] = full.radial[s3 + 1];
    radial[i3 + 2] = full.radial[s3 + 2];
    randDir[i3] = full.randDir[s3];
    randDir[i3 + 1] = full.randDir[s3 + 1];
    randDir[i3 + 2] = full.randDir[s3 + 2];
    rand[i] = full.rand[s];
    size[i] = full.size[s];
  }

  particleGeo.setAttribute('position', new THREE.BufferAttribute(home, 3));
  particleGeo.setAttribute('aHome', new THREE.BufferAttribute(home, 3));
  particleGeo.setAttribute('aText', new THREE.BufferAttribute(text, 3));
  particleGeo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  particleGeo.setAttribute('aRadial', new THREE.BufferAttribute(radial, 3));
  particleGeo.setAttribute('aRandDir', new THREE.BufferAttribute(randDir, 3));
  particleGeo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  particleGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  activeParticles = n;
  $('statCount').textContent = `粒子 ${n.toLocaleString()}`;
  $('statVerts').textContent = `顶点 ${totalVerts.toLocaleString()}`;
}

/* ------------------------------------------------------------------ */
/* 动画状态机                                                         */
/* ------------------------------------------------------------------ */

let cycleTimeout = null;
let actionTimeout = null;
let cycling = false;

function stopCycle() {
  cycling = false;
  if (cycleTimeout) clearTimeout(cycleTimeout);
  cycleTimeout = null;
}

function clearPending() {
  stopCycle();
  killTweens();
  if (actionTimeout) clearTimeout(actionTimeout);
  actionTimeout = null;
}

function ensureParticlesVisible(quick = false) {
  const dur = quick ? 0.55 : 1.2;
  tween(state, 'meshOpacity', 0, dur);
  tween(state, 'particleOpacity', 1, dur);
}

/* 单个动作：供按钮与自动循环复用 */
const actions = {
  original() {
    clearPending();
    tween(state, 'meshOpacity', 1, 1.1);
    tween(state, 'particleOpacity', 0, 1.1);
    tween(state, 'spread', 0, 1.1);
    tween(state, 'morph', 0, 1.1);
    state.spreadMode = 0;
  },
  particles() {
    clearPending();
    state.spreadMode = 0;
    tween(state, 'spread', 0, 1.2);
    tween(state, 'morph', 0, 1.4);
    ensureParticlesVisible();
  },
  text() {
    clearPending();
    state.spreadMode = 1;
    const go = () => {
      if (state.morph < 0.5) {
        // 从花束形状出发：先散成云 → 渐变到字母 → 聚合拼字
        tween(state, 'spread', 1, 1.0, EASE.inOutSine, () => {
          tween(state, 'morph', 1, 1.8, EASE.inOutCubic, () => {
            tween(state, 'spread', 0, 1.8, EASE.inOutCubic);
          });
        });
      } else {
        // 已经在字母形状：散开再聚合，重新拼一遍
        tween(state, 'spread', 1, 1.0, EASE.inOutSine, () => {
          tween(state, 'spread', 0, 1.8, EASE.inOutCubic);
        });
      }
    };
    if (state.particleOpacity < 0.98 || state.meshOpacity > 0.02) {
      ensureParticlesVisible(true);
      actionTimeout = setTimeout(go, 620);
    } else {
      go();
    }
  },
  explode() {
    clearPending();
    state.spreadMode = 0;
    if (state.particleOpacity < 0.98 || state.meshOpacity > 0.02) {
      ensureParticlesVisible(true);
      actionTimeout = setTimeout(() => {
        tween(state, 'spread', 1, 1.9, EASE.outCubic);
      }, 620);
    } else {
      tween(state, 'spread', 1, 1.9, EASE.outCubic);
    }
  },
  scatter() {
    clearPending();
    state.spreadMode = 1;
    if (state.particleOpacity < 0.98 || state.meshOpacity > 0.02) {
      ensureParticlesVisible(true);
      actionTimeout = setTimeout(() => {
        tween(state, 'spread', 1, 2.1, EASE.inOutSine);
      }, 620);
    } else {
      tween(state, 'spread', 1, 2.1, EASE.inOutSine);
    }
  },
  aggregate() {
    clearPending();
    ensureParticlesVisible(true);
    tween(state, 'spread', 0, 2.2, EASE.inOutCubic);
  },
};

/* 自动循环序列：粒子化 → 云 → 爆炸 → 聚合 → 散射 → 聚合 → 还原 */
const CYCLE = [
  { dur: 1.5, fn: () => { state.spreadMode = 0; tween(state, 'spread', 0, 0.8); tween(state, 'morph', 0, 0.8); ensureParticlesVisible(); } },
  { dur: 2.0 },                                                  // 粒子云保持
  { dur: 2.2, fn: () => tween(state, 'spread', 1, 2.0, EASE.outCubic) },
  { dur: 1.8 },                                                  // 爆炸散开保持
  { dur: 2.4, fn: () => tween(state, 'spread', 0, 2.2, EASE.inOutCubic) },
  { dur: 1.3 },                                                  // 聚合保持
  { dur: 2.0, fn: () => { state.spreadMode = 1; tween(state, 'spread', 1, 1.9, EASE.inOutSine); } },
  { dur: 1.6 },                                                  // 散射保持
  { dur: 2.4, fn: () => tween(state, 'spread', 0, 2.2, EASE.inOutCubic) },
  { dur: 1.5 },                                                  // 再次聚合保持
  { dur: 1.4, fn: () => { tween(state, 'particleOpacity', 0, 1.3); tween(state, 'meshOpacity', 1, 1.3); } },
  { dur: 1.3 },                                                  // 原貌保持
];

function actionCycle() {
  clearPending();
  cycling = true;
  cycleStep(0);
}

function cycleStep(i) {
  if (!cycling) return;
  const step = CYCLE[i % CYCLE.length];
  if (step.fn) step.fn();
  cycleTimeout = setTimeout(() => cycleStep(i + 1), step.dur * 1000);
}

/* ------------------------------------------------------------------ */
/* 每帧更新                                                           */
/* ------------------------------------------------------------------ */

function updateFrame(dt, elapsed) {
  updateTweens(dt);

  const u = particleMaterial.uniforms;
  u.uTime.value = elapsed;
  u.uSpread.value = state.spread;
  u.uSpreadMode.value = state.spreadMode;
  u.uSpreadDist.value =
    parseFloat($('explodeDist').value) * (state.spreadMode === 0 ? 1 : 0.6);
  u.uMorph.value = state.morph;
  u.uParticleOpacity.value = state.particleOpacity;
  u.uSizeScale.value = parseFloat($('particleSize').value);

  if (particleSystem) particleSystem.visible = state.particleOpacity > 0.004;
  if (modelRoot) modelRoot.visible = state.meshOpacity > 0.004;

  // 材质溶解：不同材质带细微错峰，让“粒子化”更自然
  for (let i = 0; i < modelMaterials.length; i++) {
    const m = modelMaterials[i];
    const base = m.userData.baseOpacity;
    const offset = m.userData.dissolveOffset;
    m.opacity = base * clamp01(state.meshOpacity * 1.35 - offset);
  }

  controls.autoRotate = $('autoRotate').checked;
  controls.update();
  composer.render();
}

/* ------------------------------------------------------------------ */
/* UI                                                                 */
/* ------------------------------------------------------------------ */

let activeButton = null;

function setActiveButton(action) {
  if (activeButton) activeButton.classList.remove('active');
  activeButton = document.querySelector(`.ctrl-btn[data-action="${action}"]`);
  if (activeButton) activeButton.classList.add('active');
  updateSlider();
}

/* 滑动指示器跟随当前选中的按钮 */
function updateSlider() {
  const slider = $('ctrlSlider');
  if (!slider) return;
  if (!activeButton) {
    slider.style.opacity = '0';
    return;
  }
  slider.style.opacity = '1';
  slider.style.setProperty('--slider-x', `${activeButton.offsetLeft}px`);
  slider.style.setProperty('--slider-y', `${activeButton.offsetTop}px`);
  slider.style.setProperty('--slider-w', `${activeButton.offsetWidth}px`);
  slider.style.setProperty('--slider-h', `${activeButton.offsetHeight}px`);
}

function setupUI() {
  const btnMap = {
    original: 'original',
    particles: 'particles',
    explode: 'explode',
    aggregate: 'aggregate',
    text: 'text',
    cycle: 'cycle',
  };

  document.querySelectorAll('.ctrl-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btnMap[btn.dataset.action];
      if (!action) return;
      if (action === 'cycle') {
        if (cycling) {
          // 再次点击：关闭自动循环，保持当前画面
          clearPending();
          setActiveButton(null);
        } else {
          actionCycle();
          setActiveButton('cycle');
        }
        return;
      }
      actions[action]();
      setActiveButton(action);
    });
  });

  const fmtCount = (v) => (v >= 10000 ? `${(v / 10000).toFixed(1).replace(/\.0$/, '')}万` : v);

  const countInput = $('particleCount');
  const countVal = $('particleCountVal');
  countInput.addEventListener('input', () => {
    const v = parseInt(countInput.value, 10);
    countVal.textContent = fmtCount(v);
    applyParticleCount(v);
  });

  const sizeInput = $('particleSize');
  $('particleSizeVal').textContent = sizeInput.value;
  sizeInput.addEventListener('input', () => {
    $('particleSizeVal').textContent = Number(sizeInput.value).toFixed(1);
  });

  const distInput = $('explodeDist');
  $('explodeDistVal').textContent = distInput.value;
  distInput.addEventListener('input', () => {
    $('explodeDistVal').textContent = Number(distInput.value).toFixed(1);
  });

  const bloomInput = $('bloomStrength');
  $('bloomStrengthVal').textContent = Number(bloomInput.value).toFixed(2);
  bloomInput.addEventListener('input', () => {
    const v = parseFloat(bloomInput.value);
    $('bloomStrengthVal').textContent = v.toFixed(2);
    bloomPass.strength = v;
  });

  const settings = $('settings');
  $('settingsToggle').addEventListener('click', () => settings.classList.toggle('open'));
}

/* ------------------------------------------------------------------ */
/* 加载流程                                                           */
/* ------------------------------------------------------------------ */

function hideLoading() {
  setTimeout(() => {
    $('loading').classList.add('hidden');
  }, 350);
}

function showLoadError(msg) {
  $('loadingText').textContent = msg;
  $('loadingBar') && ($('loadingBar').style.display = 'none');
}

function init() {
  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    onModelLoaded,
    (xhr) => {
      if (xhr.total) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        $('loadingFill').style.width = `${pct}%`;
        $('loadingText').textContent = `正在加载模型 ${pct}%`;
      }
    },
    (err) => {
      console.error(err);
      showLoadError('模型加载失败，请确认通过本地服务器访问');
    }
  );
}

/* 尺寸 */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);

  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  particleMaterial.uniforms.uScaleFactor.value =
    renderer.domElement.clientHeight / (2 * Math.tan(fovRad / 2));
  updateSlider();
}

/* 主循环 */
let lastTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const elapsed = now / 1000;
  updateFrame(dt, elapsed);
}

window.addEventListener('resize', resize);
resize();
init();
animate(0);

/* 调试钩子（便于自动化验证） */
window.__app = {
  get state() {
    return { ...state };
  },
  get uniforms() {
    return {
      spread: particleMaterial.uniforms.uSpread.value,
      mode: particleMaterial.uniforms.uSpreadMode.value,
      dist: particleMaterial.uniforms.uSpreadDist.value,
      opacity: particleMaterial.uniforms.uParticleOpacity.value,
      sizeScale: particleMaterial.uniforms.uSizeScale.value,
    };
  },
  bloom: () => bloomPass.strength,
  camera: () => ({
    x: +camera.position.x.toFixed(3),
    y: +camera.position.y.toFixed(3),
    z: +camera.position.z.toFixed(3),
  }),
};
