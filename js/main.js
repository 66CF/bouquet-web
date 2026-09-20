import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CONFIG } from "./config.js";
import { createScene } from "./scene.js";
import { createBouquet } from "./particles.js";
import { createEffects } from "./effects.js";
import { createUI } from "./ui.js";
import { hideLoading, showLoadError, setLoadingProgress } from "./loading.js";

const canvas = document.getElementById("scene");
const stage = document.getElementById("stage");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const mobile = matchMedia("(pointer: coarse)").matches;
const pixelRatio = () => Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2);
const settings = {
  size: CONFIG.size,
  distance: CONFIG.distance,
  bloom: CONFIG.bloom,
  count: mobile ? CONFIG.mobileParticles : CONFIG.desktopParticles,
  autoRotate: !reducedMotion.matches,
};
const view = createScene(canvas, { ...settings, pixelRatio: pixelRatio() });
const effects = createEffects();
let bouquet = null;
let frameId = null;
let lastTime = null;
let elapsed = 0;
let failed = false;
let suspended = false;

function requestRender() {
  if (!bouquet || frameId !== null || document.hidden || suspended || failed)
    return;
  frameId = requestAnimationFrame(animate);
}

function pauseRendering() {
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  lastTime = null;
}

const ui = createUI({
  settings,
  reducedMotion,
  onAction(action) {
    const selected = effects.run(action);
    requestRender();
    return selected;
  },
  onCount(count) {
    const actual = bouquet.setCount(count);
    ui.setStats(actual, bouquet.totalVerts, bouquet.capacity);
    requestRender();
    return actual;
  },
  onChange() {
    view.setBloom(settings.bloom);
    requestRender();
  },
  onReset() {
    view.fit(bouquet.size);
    requestRender();
  },
});

function resize() {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  const ratio = pixelRatio();
  view.resize(width, height, ratio);
  if (bouquet) {
    const uniforms = bouquet.material.uniforms;
    uniforms.uPixelRatio.value = ratio;
    uniforms.uScaleFactor.value =
      height / (2 * Math.tan((view.camera.fov * Math.PI) / 360));
  }
  requestRender();
}

function animate(now) {
  frameId = null;
  const dt = lastTime === null ? 0 : Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;
  effects.update(dt);
  const { state } = effects;
  view.controls.autoRotate = settings.autoRotate;
  view.controls.update(dt);
  view.camera.updateMatrixWorld();

  const u = bouquet.material.uniforms;
  u.uTime.value = elapsed;
  u.uSpread.value = state.spread;
  u.uSpreadMode.value = state.spreadMode;
  u.uSpreadDist.value = settings.distance * bouquet.size.length() * 0.32;
  u.uMorph.value = state.morph;
  u.uWriting.value = state.writing;
  u.uWriteProgress.value = state.writeProgress;
  u.uTextGlow.value = state.textGlow;
  u.uParticleOpacity.value = state.particleOpacity;
  u.uSizeScale.value = settings.size;
  u.uCameraRight.value.setFromMatrixColumn(view.camera.matrixWorld, 0);
  u.uCameraUp.value.setFromMatrixColumn(view.camera.matrixWorld, 1);
  u.uCameraBack.value.setFromMatrixColumn(view.camera.matrixWorld, 2);
  bouquet.points.visible = state.particleOpacity > 0.004;
  bouquet.setOpacity(state.meshOpacity);
  view.render(dt, state);

  if (settings.autoRotate || effects.active || state.particleOpacity > 0.004)
    requestRender();
  if (frameId === null) lastTime = null;
}

async function init() {
  try {
    const gltf = await new GLTFLoader().loadAsync(CONFIG.modelUrl, (event) => {
      if (!event.total) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setLoadingProgress(
        Math.round(percent * 0.7),
        `正在打开花房 · ${percent}%`,
      );
    });
    view.prepareModel(gltf.scene);
    const result = await createBouquet(gltf.scene, {
      maxParticles: CONFIG.maxParticles,
      pixelRatio: pixelRatio(),
      text: CONFIG.text,
      onProgress: setLoadingProgress,
    });
    // GPU 上下文丢失期间完成的异步加载不能覆盖错误提示。
    if (failed) return;
    bouquet = result;
    view.scene.add(bouquet.model, bouquet.points);
    settings.count = bouquet.setCount(settings.count);
    ui.setStats(settings.count, bouquet.totalVerts, bouquet.capacity);
    resize();
    view.fit(bouquet.size);
    hideLoading();
    document.getElementById("app").classList.add("ready");
    requestRender();
  } catch (error) {
    console.error(error);
    failed = true;
    pauseRendering();
    showLoadError("花束加载失败，请检查网络连接，并通过 HTTP 服务器打开页面。");
  }
}

view.controls.addEventListener("change", requestRender);
new ResizeObserver(resize).observe(stage);
window.addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("is-paused", document.hidden);
  if (document.hidden) pauseRendering();
  else requestRender();
});
window.addEventListener("pagehide", () => {
  suspended = true;
  pauseRendering();
});
window.addEventListener("pageshow", () => {
  suspended = false;
  requestRender();
});
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  failed = true;
  pauseRendering();
  showLoadError("图形显示已中断，请重新加载以恢复花束。");
});
resize();
init();
