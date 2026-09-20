import * as THREE from "three";
import { mulberry32, srgbToLinear, yieldToBrowser } from "./utils.js";
import { buildTextTargets } from "./text-targets.js";
import { createParticleMaterial } from "./particle-material.js";

const linearColor = Float32Array.from({ length: 256 }, (_, value) =>
  srgbToLinear(value / 255),
);
const textureCache = new Map();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpVec3 = new THREE.Vector3();
const tmpUv = new THREE.Vector2();

function getTextureData(texture) {
  if (textureCache.has(texture.uuid)) return textureCache.get(texture.uuid);
  const img = texture.image;
  if (!img || !img.width) return null;
  const maxSampleSize = 256;
  const scale = Math.min(1, maxSampleSize / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  texture.updateMatrix();
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
  texture.transformUv(tmpUv.set(u, v));
  const x = Math.min(td.w - 1, Math.max(0, Math.floor(tmpUv.x * td.w)));
  const y = Math.min(td.h - 1, Math.max(0, Math.floor(tmpUv.y * td.h)));
  const i = (y * td.w + x) * 4;
  target[offset] = linearColor[td.data[i]] * fallback[0];
  target[offset + 1] = linearColor[td.data[i + 1]] * fallback[1];
  target[offset + 2] = linearColor[td.data[i + 2]] * fallback[2];
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
async function sampleModelSurface(root, count, onProgress) {
  const meshes = [];
  let totalArea = 0;

  root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
    const geo = obj.geometry;
    const posAttr = geo.attributes.position;
    if (!posAttr) return;

    const indexAttr = geo.index;
    const triCount = Math.floor(
      (indexAttr ? indexAttr.count : posAttr.count) / 3,
    );
    if (!triCount) return;

    const uvAttr = geo.attributes.uv;
    const material = Array.isArray(obj.material)
      ? obj.material[0]
      : obj.material;
    const map = material && material.map ? material.map : null;
    const fallbackColor =
      material && material.color
        ? [material.color.r, material.color.g, material.color.b]
        : [0.9, 0.85, 0.95];

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
    if (i % 8192 === 0) {
      onProgress(70 + Math.round((i / count) * 15), "正在生成粒子表面…");
      await yieldToBrowser();
    }
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
      const u =
        mesh.uvAttr.getX(ia) * wa +
        mesh.uvAttr.getX(ib) * wb +
        mesh.uvAttr.getX(ic) * wc;
      const v =
        mesh.uvAttr.getY(ia) * wa +
        mesh.uvAttr.getY(ib) * wb +
        mesh.uvAttr.getY(ic) * wc;
      sampleColorInto(mesh.map, u, v, mesh.fallbackColor, colors, i3);
    } else {
      sampleColorInto(null, 0, 0, mesh.fallbackColor, colors, i3);
    }
  }

  textureCache.clear();
  return { positions, colors };
}

export async function createBouquet(
  modelRoot,
  { maxParticles, pixelRatio, text, onProgress = () => {} },
) {
  let totalVerts = 0;
  const full = {};
  const materials = new Set();
  modelRoot.updateMatrixWorld(true);

  const bbox = new THREE.Box3().setFromObject(modelRoot);

  modelRoot.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh) return;
    const posAttr = obj.geometry.attributes.position;
    if (posAttr) totalVerts += posAttr.count;
    for (const material of [obj.material].flat())
      if (material) materials.add(material);
  });

  if (totalVerts === 0) {
    throw new Error("模型中未找到可渲染的网格");
  }

  onProgress(70, "正在生成粒子表面…");
  await yieldToBrowser();
  const particleCapacity = Math.min(totalVerts, maxParticles);
  const sampled = await sampleModelSurface(
    modelRoot,
    particleCapacity,
    onProgress,
  );
  if (!sampled) {
    throw new Error("无法从模型表面生成粒子");
  }
  const { positions, colors } = sampled;

  // 把模型居中到原点，粒子坐标同样减去中心
  const center = bbox.getCenter(new THREE.Vector3());
  modelRoot.position.sub(center);
  const size = bbox.getSize(new THREE.Vector3());

  full.home = positions;
  full.color = colors;
  full.radial = new Float32Array(particleCapacity * 3);
  full.randDir = new Float32Array(particleCapacity * 3);
  full.rand = new Float32Array(particleCapacity);
  full.size = new Float32Array(particleCapacity);

  // 字母 "zwc" 的目标点阵（相对模型尺寸缩放）
  const textTargets = await buildTextTargets(particleCapacity, text);
  const textScale = size.length() * 0.55;
  full.text = textTargets || new Float32Array(particleCapacity * 3);
  for (let i = 0; i < particleCapacity; i++) {
    if (i % 16384 === 0) {
      onProgress(
        85 + Math.round((i / particleCapacity) * 14),
        "正在准备花束动画…",
      );
      await yieldToBrowser();
    }
    const i3 = i * 3;
    const x = positions[i3] - center.x;
    const y = positions[i3 + 1] - center.y;
    const z = positions[i3 + 2] - center.z;

    full.home[i3] = x;
    full.home[i3 + 1] = y;
    full.home[i3 + 2] = z;

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
      const l = Math.hypot(
        full.radial[i3],
        full.radial[i3 + 1],
        full.radial[i3 + 2],
      );
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
    full.size[i] = size.y * (0.0028 + r1 * 0.0035);

    if (textTargets) {
      full.text[i3] = textTargets[i3] * textScale;
      full.text[i3 + 1] = textTargets[i3 + 1] * textScale;
      full.text[i3 + 2] = textTargets[i3 + 2] * textScale;
    }
  }

  // 粒子系统
  const particleGeo = new THREE.BufferGeometry();
  const homeAttr = new THREE.BufferAttribute(full.home, 3);
  particleGeo.setAttribute("position", homeAttr);
  particleGeo.setAttribute("aHome", homeAttr);
  particleGeo.setAttribute("aText", new THREE.BufferAttribute(full.text, 3));
  particleGeo.setAttribute("aColor", new THREE.BufferAttribute(full.color, 3));
  particleGeo.setAttribute(
    "aRadial",
    new THREE.BufferAttribute(full.radial, 3),
  );
  particleGeo.setAttribute(
    "aRandDir",
    new THREE.BufferAttribute(full.randDir, 3),
  );
  particleGeo.setAttribute("aRand", new THREE.BufferAttribute(full.rand, 1));
  particleGeo.setAttribute("aSize", new THREE.BufferAttribute(full.size, 1));
  const particleMaterial = createParticleMaterial(pixelRatio);
  particleMaterial.uniforms.uTextScale.value = textScale;
  const particleSystem = new THREE.Points(particleGeo, particleMaterial);
  particleSystem.frustumCulled = false;
  let lastOpacity = null;
  const materialStates = [...materials].map((material, index) => ({
    material,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    dissolveOffset: (index / Math.max(1, materials.size - 1)) * 0.32,
  }));

  return {
    model: modelRoot,
    points: particleSystem,
    material: particleMaterial,
    size,
    totalVerts,
    capacity: particleCapacity,
    setCount(count) {
      const actual = Math.min(particleCapacity, Math.max(1, Math.round(count)));
      particleGeo.setDrawRange(0, actual);
      return actual;
    },
    setOpacity(opacity) {
      modelRoot.visible = opacity > 0.004;
      if (lastOpacity === opacity) return;
      for (const original of materialStates) {
        const { material } = original;
        const fading = opacity < 0.999;
        material.opacity = fading
          ? original.opacity *
            THREE.MathUtils.clamp(
              opacity * 1.35 - original.dissolveOffset,
              0,
              1,
            )
          : original.opacity;
        material.depthWrite = fading ? false : original.depthWrite;
        const transparent = fading || original.transparent;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
      }
      lastOpacity = opacity;
    },
  };
}
