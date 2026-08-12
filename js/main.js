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
  attribute float aTextPhase;

  uniform float uTime;
  uniform float uSpread;
  uniform float uSpreadMode;
  uniform float uSpreadDist;
  uniform float uMorph;
  uniform float uWriting;
  uniform float uTextMode;
  uniform float uTextPulse;
  uniform float uParticleOpacity;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uScaleFactor;
  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;
  uniform vec3 uCameraBack;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vInkGlow;

  void main() {
    float r1 = fract(aRand * 7.13);
    float r2 = fract(aRand * 3.71);

    // 爆炸 / 散射：每个粒子有随机延迟，运动更自然
    float delay = r1 * 0.30;
    float e = smoothstep(delay, 1.0, uSpread);
    vec3 dir = mix(aRadial, aRandDir, step(0.5, uSpreadMode));
    float dist = uSpreadDist * (0.25 + 0.75 * r2) * (1.0 - 0.25 * uSpreadMode);
    // 文字始终使用相机朝向的基向量，旋转场景后也不会镜像或变窄。
    vec3 textBase =
      uCameraRight * aText.x +
      uCameraUp * aText.y +
      uCameraBack * aText.z;
    // 写字模式：粒子不是同时“贴”到文字上，而是沿着左→右的笔锋依次落位。
    // 尚未落笔的粒子围绕文字旋转成能量丝带，笔锋经过时收束到字形。
    float phase = clamp(aTextPhase, 0.0, 1.0);
    float ink = smoothstep(phase * 0.82, phase * 0.82 + 0.18, uWriting);
    float textMorph = uMorph * mix(1.0, ink, uTextMode);
    vec3 base = mix(aHome, textBase, textMorph);

    float lead = 1.0 - smoothstep(0.035, 0.13, abs(uWriting - phase));
    // 笔锋抵达末端后立即熄灭，避免最右侧粒子永久处于高亮状态。
    lead *= 1.0 - smoothstep(0.94, 1.0, uWriting);
    float angle = aRand * 18.8496 + uTime * (1.6 + r1);
    float ribbon = uTextMode * uMorph * (1.0 - ink);
    float ribbonRadius = (0.16 + 0.48 * r2) * ribbon;
    vec3 ribbonOffset =
      uCameraUp * sin(angle) * ribbonRadius +
      uCameraBack * cos(angle) * ribbonRadius +
      uCameraRight * (0.18 * sin(angle * 0.37));

    // 完成落款时从文字中心向外弹出一圈细微冲击波。
    float pulse = sin(clamp(uTextPulse, 0.0, 1.0) * 3.14159);
    vec2 textDir = normalize(aText.xy + vec2(0.0001));
    vec3 pulseOffset = (uCameraRight * textDir.x + uCameraUp * textDir.y)
      * pulse * (0.08 + 0.16 * r1) * uTextMode;

    vec3 pos = base + dir * dist * e + ribbonOffset + pulseOffset;

    // 轻微漂浮，让云层有呼吸感
    pos.x += sin(uTime * 0.6 + aRand * 6.2831) * 0.004;
    pos.y += cos(uTime * 0.45 + r1 * 6.2831) * 0.004;
    pos.z += sin(uTime * 0.5 + r2 * 6.2831) * 0.004;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.70 + 0.30 * sin(uTime * (1.0 + r1 * 3.0) + r2 * 6.2831);
    // 聚合状态降低叠加亮度，散开后再补偿透明度，保留花瓣颜色层次。
    float densityCompensation = mix(0.58, 0.85, uSpread);
    vInkGlow = max(lead * uTextMode, pulse * 0.55 * uTextMode);
    // 十几万粒子压进字形后需要显著降低单点能量，否则加色混合会把镂空笔画淹没。
    float textDensity = mix(1.0, 0.30 + 0.42 * vInkGlow, uTextMode * ink);
    vAlpha = uParticleOpacity * mix(twinkle * densityCompensation, 1.0, vInkGlow * 0.82) * textDensity;
    // 笔锋是冰蓝色，落笔瞬间转为粉紫高光，再回到花束原色。
    vec3 inkColor = mix(vec3(0.22, 0.82, 1.0), vec3(1.0, 0.28, 0.78), r1);
    vColor = mix(aColor, inkColor, vInkGlow * 0.82);

    // 爆炸/散射过程中粒子略微放大，保证散开后仍有光点存在感
    float settledScale = mix(1.0, 0.52, uTextMode * ink);
    float size = aSize * uSizeScale * (1.0 + 0.8 * uSpread + 1.8 * vInkGlow) * settledScale;
    gl_PointSize = size * uPixelRatio * uScaleFactor / max(0.1, -mv.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 24.0);
  }
`;

const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vInkGlow;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a = a * a;                    // 柔和光斑
    float core = smoothstep(0.42, 0.0, d);
    vec3 col = vColor * (0.8 + 0.45 * a + 1.35 * core * vInkGlow);
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
    uWriting: { value: 0 },
    uTextMode: { value: 0 },
    uTextPulse: { value: 0 },
    uParticleOpacity: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    uSizeScale: { value: 1.0 },
    uScaleFactor: { value: 1000 },
    uCameraRight: { value: new THREE.Vector3(1, 0, 0) },
    uCameraUp: { value: new THREE.Vector3(0, 1, 0) },
    uCameraBack: { value: new THREE.Vector3(0, 0, 1) },
  },
  transparent: true,
  premultipliedAlpha: true,
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
  writing: 0, // 0..1 = 写字笔锋的横向进度
  textMode: 0,
  textPulse: 0,
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
  textPhase: null,
};

const textureCache = new Map();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpVec3 = new THREE.Vector3();

function getTextureData(texture) {
  if (textureCache.has(texture.uuid)) return textureCache.get(texture.uuid);
  const img = texture.image;
  if (!img || !img.width) return null;
  const maxSampleSize = 256;
  const scale = Math.min(1, maxSampleSize / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const td = { data, w: c.width, h: c.height };
  textureCache.set(texture.uuid, td);
  return td;
}

function sampleColorInto(texture, u, v, fallback, target, offset) {
  if (!texture) {
    target[offset] = fallback[0];
    target[offset + 1] = fallback[1];
    target[offset + 2] = fallback[2];
    return;
  }
  const td = getTextureData(texture);
  if (!td) {
    target[offset] = fallback[0];
    target[offset + 1] = fallback[1];
    target[offset + 2] = fallback[2];
    return;
  }
  const x = Math.floor((((u % 1) + 1) % 1) * (td.w - 1));
  const y = Math.floor((((v % 1) + 1) % 1) * (td.h - 1));
  const i = (y * td.w + x) * 4;
  target[offset] = srgbToLinear(td.data[i] / 255) * fallback[0];
  target[offset + 1] = srgbToLinear(td.data[i + 1] / 255) * fallback[1];
  target[offset + 2] = srgbToLinear(td.data[i + 2] / 255) * fallback[2];
}

function lowerBound(values, target) {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* 按三角形世界空间面积采样，避免粒子密度跟随模型拓扑密度。 */
function sampleModelSurface(root, count) {
  const meshes = [];
  let totalArea = 0;

  root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
    const geo = obj.geometry;
    const posAttr = geo.attributes.position;
    if (!posAttr) return;

    const indexAttr = geo.index;
    const triCount = Math.floor((indexAttr ? indexAttr.count : posAttr.count) / 3);
    if (!triCount) return;

    const uvAttr = geo.attributes.uv;
    const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const map = material && material.map ? material.map : null;
    const fallbackColor = material && material.color
      ? [material.color.r, material.color.g, material.color.b]
      : [0.9, 0.85, 0.95];

    if (material && !modelMaterials.includes(material)) modelMaterials.push(material);

    obj.updateWorldMatrix(true, false);
    const matrixWorld = obj.matrixWorld.clone();
    const cumulativeAreas = new Float64Array(triCount);
    let meshArea = 0;

    for (let tri = 0; tri < triCount; tri++) {
      const base = tri * 3;
      const ia = indexAttr ? indexAttr.getX(base) : base;
      const ib = indexAttr ? indexAttr.getX(base + 1) : base + 1;
      const ic = indexAttr ? indexAttr.getX(base + 2) : base + 2;

      tmpVec.fromBufferAttribute(posAttr, ia).applyMatrix4(matrixWorld);
      tmpVec2.fromBufferAttribute(posAttr, ib).applyMatrix4(matrixWorld);
      tmpVec3.fromBufferAttribute(posAttr, ic).applyMatrix4(matrixWorld);
      tmpVec2.sub(tmpVec);
      tmpVec3.sub(tmpVec);
      meshArea += tmpVec2.cross(tmpVec3).length() * 0.5;
      cumulativeAreas[tri] = meshArea;
    }

    if (meshArea <= 1e-12) return;
    totalArea += meshArea;
    meshes.push({
      posAttr,
      uvAttr,
      indexAttr,
      matrixWorld,
      map,
      fallbackColor,
      cumulativeAreas,
      areaStart: totalArea - meshArea,
      areaEnd: totalArea,
    });
  });

  if (!meshes.length || totalArea <= 0) return null;

  const meshEnds = Float64Array.from(meshes, (mesh) => mesh.areaEnd);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const rand = mulberry32(20260809);

  for (let i = 0; i < count; i++) {
    const mesh = meshes[lowerBound(meshEnds, rand() * totalArea)];
    const localArea = rand() * (mesh.areaEnd - mesh.areaStart);
    const tri = lowerBound(mesh.cumulativeAreas, localArea);
    const base = tri * 3;
    const ia = mesh.indexAttr ? mesh.indexAttr.getX(base) : base;
    const ib = mesh.indexAttr ? mesh.indexAttr.getX(base + 1) : base + 1;
    const ic = mesh.indexAttr ? mesh.indexAttr.getX(base + 2) : base + 2;

    // sqrt 分布可在三角形内得到均匀的面积采样。
    const rootR = Math.sqrt(rand());
    const r = rand();
    const wa = 1 - rootR;
    const wb = rootR * (1 - r);
    const wc = rootR * r;
    const i3 = i * 3;

    tmpVec.fromBufferAttribute(mesh.posAttr, ia).multiplyScalar(wa);
    tmpVec2.fromBufferAttribute(mesh.posAttr, ib).multiplyScalar(wb);
    tmpVec3.fromBufferAttribute(mesh.posAttr, ic).multiplyScalar(wc);
    tmpVec.add(tmpVec2).add(tmpVec3).applyMatrix4(mesh.matrixWorld);
    positions[i3] = tmpVec.x;
    positions[i3 + 1] = tmpVec.y;
    positions[i3 + 2] = tmpVec.z;

    if (mesh.uvAttr) {
      const u = mesh.uvAttr.getX(ia) * wa + mesh.uvAttr.getX(ib) * wb + mesh.uvAttr.getX(ic) * wc;
      const v = mesh.uvAttr.getY(ia) * wa + mesh.uvAttr.getY(ib) * wb + mesh.uvAttr.getY(ic) * wc;
      sampleColorInto(mesh.map, u, v, mesh.fallbackColor, colors, i3);
    } else {
      sampleColorInto(null, 0, 0, mesh.fallbackColor, colors, i3);
    }
  }

  textureCache.clear();
  return { positions, colors };
}

/* 用 Canvas 把 "Z W C" 渲染成点阵，生成粒子拼字的目标位置 */
function buildTextTargets(count) {
  const W = 900;
  const H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 22;
  ctx.lineJoin = 'round';
  ctx.font = '900 210px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 独立描边字母比实心连写更适合高密度粒子：留白清晰，也更像霓虹落款。
  ctx.strokeText('Z', 190, H / 2);
  ctx.strokeText('W', 450, H / 2);
  ctx.strokeText('C', 710, H / 2);
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

  const bbox = new THREE.Box3().setFromObject(modelRoot);

  modelRoot.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
    const posAttr = obj.geometry.attributes.position;
    if (posAttr) totalVerts += posAttr.count;
  });

  if (totalVerts === 0) {
    showLoadError('模型中未找到可渲染的网格');
    return;
  }

  $('loadingText').textContent = '正在生成粒子表面…';
  const sampled = sampleModelSurface(modelRoot, totalVerts);
  if (!sampled) {
    showLoadError('无法从模型表面生成粒子');
    return;
  }
  const { positions, colors } = sampled;

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
  full.textPhase = new Float32Array(totalVerts);
  full.text = new Float32Array(totalVerts * 3);

  const centerY = center.y;
  // 字母 "Z W C" 的目标点阵（相对模型尺寸缩放）
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
      // 以横向位置为主，混入少量纵向与随机差异，形成有机笔锋而非直线擦除。
      full.textPhase[i] = clamp01(textTargets[i3] + 0.5 + textTargets[i3 + 1] * 0.08 + (r2 - 0.5) * 0.045);
    }
  }

  // 粒子系统
  particleGeo = new THREE.BufferGeometry();
  const homeAttr = new THREE.BufferAttribute(full.home, 3);
  particleGeo.setAttribute('position', homeAttr);
  particleGeo.setAttribute('aHome', homeAttr);
  particleGeo.setAttribute('aText', new THREE.BufferAttribute(full.text, 3));
  particleGeo.setAttribute('aColor', new THREE.BufferAttribute(full.color, 3));
  particleGeo.setAttribute('aRadial', new THREE.BufferAttribute(full.radial, 3));
  particleGeo.setAttribute('aRandDir', new THREE.BufferAttribute(full.randDir, 3));
  particleGeo.setAttribute('aRand', new THREE.BufferAttribute(full.rand, 1));
  particleGeo.setAttribute('aSize', new THREE.BufferAttribute(full.size, 1));
  particleGeo.setAttribute('aTextPhase', new THREE.BufferAttribute(full.textPhase, 1));
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
  const n = Math.min(totalVerts, Math.max(2, Math.round(targetCount)));
  if (n < 2) return;
  particleGeo.setDrawRange(0, n);

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

function setWritingAura(active, replay = false) {
  const aura = $('writingAura');
  if (!aura) return;
  if (replay) {
    aura.classList.remove('active');
    // 强制刷新动画时间线，连续点击“写字”也会从头播放。
    void aura.offsetWidth;
  }
  aura.classList.toggle('active', active);
}

function leaveTextMode() {
  setWritingAura(false);
  state.textMode = 0;
  state.textPulse = 0;
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
    leaveTextMode();
    tween(state, 'meshOpacity', 1, 1.1);
    tween(state, 'particleOpacity', 0, 1.1);
    tween(state, 'spread', 0, 1.1);
    tween(state, 'morph', 0, 1.1);
    state.spreadMode = 0;
  },
  particles() {
    clearPending();
    leaveTextMode();
    state.spreadMode = 0;
    tween(state, 'spread', 0, 1.2);
    tween(state, 'morph', 0, 1.4);
    ensureParticlesVisible();
  },
  text() {
    clearPending();
    state.spreadMode = 1;
    state.textMode = 1;
    state.textPulse = 0;
    state.writing = 0;
    setWritingAura(true, true);
    const go = () => {
      // 第一幕：花束坍缩为旋转星尘；第二幕：笔锋从左向右“吸附”粒子；
      // 第三幕：落款冲击波让完整字形短暂扩张并提亮。
      tween(state, 'spread', 0.62, 0.82, EASE.outCubic, () => {
        state.morph = 1;
        tween(state, 'spread', 0.02, 2.65, EASE.inOutCubic);
        tween(state, 'writing', 1, 2.45, EASE.inOutSine, () => {
          tween(state, 'textPulse', 1, 0.72, EASE.outCubic, () => {
            state.textPulse = 0;
          });
        });
      });
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
    leaveTextMode();
    state.spreadMode = 0;
    tween(state, 'morph', 0, 1.1);
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
    leaveTextMode();
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
    leaveTextMode();
    ensureParticlesVisible(true);
    tween(state, 'spread', 0, 2.2, EASE.inOutCubic);
    tween(state, 'morph', 0, 2.2, EASE.inOutCubic);
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
  leaveTextMode();
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

  controls.autoRotate = $('autoRotate').checked;
  controls.update();
  camera.updateMatrixWorld();

  const u = particleMaterial.uniforms;
  u.uTime.value = elapsed;
  u.uSpread.value = state.spread;
  u.uSpreadMode.value = state.spreadMode;
  u.uSpreadDist.value =
    parseFloat($('explodeDist').value) * (state.spreadMode === 0 ? 1 : 0.6);
  u.uMorph.value = state.morph;
  u.uWriting.value = state.writing;
  u.uTextMode.value = state.textMode;
  u.uTextPulse.value = state.textPulse;
  u.uParticleOpacity.value = state.particleOpacity;
  u.uSizeScale.value = parseFloat($('particleSize').value);
  u.uCameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
  u.uCameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
  u.uCameraBack.value.setFromMatrixColumn(camera.matrixWorld, 2);

  if (particleSystem) particleSystem.visible = state.particleOpacity > 0.004;
  if (modelRoot) modelRoot.visible = state.meshOpacity > 0.004;

  // 材质溶解：不同材质带细微错峰，让“粒子化”更自然
  for (let i = 0; i < modelMaterials.length; i++) {
    const m = modelMaterials[i];
    const base = m.userData.baseOpacity;
    const offset = m.userData.dissolveOffset;
    m.opacity = base * clamp01(state.meshOpacity * 1.35 - offset);
    // 半透明模型不再写入深度，避免在交叉淡入时遮住内部粒子。
    m.depthWrite = state.meshOpacity > 0.98;
  }

  composer.render();
}

/* ------------------------------------------------------------------ */
/* UI                                                                 */
/* ------------------------------------------------------------------ */

let activeButton = null;

function setActiveButton(action) {
  if (activeButton) {
    activeButton.classList.remove('active');
    activeButton.setAttribute('aria-pressed', 'false');
  }
  activeButton = document.querySelector(`.ctrl-btn[data-action="${action}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
    activeButton.setAttribute('aria-pressed', 'true');
  }
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
requestAnimationFrame(animate);

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
