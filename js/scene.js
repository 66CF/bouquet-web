import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// 场景、布光和取景独立于页面；后期只为高亮区域添加克制的柔光。
export function createScene(canvas, { pixelRatio, autoRotate, bloom }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.setClearColor(0x101715, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 0.38;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.maxPolarAngle = Math.PI * 0.72;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.03);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.32;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf5e6db, 0x26382e, 1.15));
  const key = new THREE.DirectionalLight(0xffebdc, 3.1);
  key.position.set(-3, 5, 4);
  const fill = new THREE.DirectionalLight(0xc9e0de, 0.8);
  fill.position.set(4, 1, 2);
  const rim = new THREE.DirectionalLight(0xf5c9b7, 2.2);
  rim.position.set(1, 3, -4);
  scene.add(key, fill, rim);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    bloom,
    0.55,
    1.0,
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // 一个低成本的柔边接触阴影，给悬浮花束提供空间参照。
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uOpacity: { value: 0.35 } },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader:
        "varying vec2 vUv; uniform float uOpacity; void main(){ float d=length((vUv-.5)*2.); float a=exp(-d*d*6.)*(1.-smoothstep(.7,1.,d)); gl_FragColor=vec4(.01,.015,.01,a*uOpacity); }",
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  let modelSize = null;
  let fittedDistance = 0;
  function frameCamera(preserveView = false) {
    if (!modelSize) return;
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const vertical = (modelSize.y * 0.52) / Math.tan(halfFov);
    const horizontal =
      (Math.max(modelSize.x, modelSize.z) * 0.52) /
      (Math.tan(halfFov) * camera.aspect);
    const distance = Math.max(vertical, horizontal) + modelSize.z * 0.5;
    const radius = modelSize.length() * 0.5;
    camera.near = Math.max(0.005, radius / 100);
    camera.far = Math.max(200, distance * 8);
    controls.minDistance = radius * 0.8;
    controls.maxDistance = distance * 3;
    if (preserveView && fittedDistance) {
      camera.position
        .sub(controls.target)
        .multiplyScalar(distance / fittedDistance)
        .add(controls.target);
    } else {
      camera.position.set(distance * 0.12, modelSize.y * 0.1, distance);
      controls.target.set(0, modelSize.y * 0.02, 0);
    }
    fittedDistance = distance;
    camera.updateProjectionMatrix();
    controls.update(0);
  }

  return {
    scene,
    camera,
    controls,
    renderer,
    setBloom(value) {
      bloomPass.strength = value;
    },
    fit(size) {
      modelSize = size;
      shadow.position.y = -size.y * 0.54;
      shadow.scale.set(size.x * 1.6, size.z * 1.6, 1);
      frameCamera();
    },
    prepareModel(root) {
      const converted = new Map();
      const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const convert = (source) => {
        if (converted.has(source)) return converted.get(source);
        // GLB 的 KHR_materials_unlit 会导入 MeshBasicMaterial；需要主动转换才会响应灯光。
        const petals = /Petals/i.test(source.name);
        const leaves = /Leaves|Stems/i.test(source.name);
        const material = new THREE.MeshPhysicalMaterial({
          name: source.name,
          map: source.map,
          color: source.color
            .clone()
            .multiply(
              new THREE.Color(petals ? 0xf3c5bf : leaves ? 0xa4b990 : 0xe9dfcd),
            ),
          side: source.side,
          transparent: source.transparent,
          opacity: source.opacity,
          alphaTest: source.alphaTest,
          depthWrite: source.depthWrite,
          roughness: petals ? 0.82 : 0.92,
          metalness: 0,
          sheen: petals ? 0.32 : 0.08,
          sheenColor: new THREE.Color(0xf7d4ca),
          sheenRoughness: 0.8,
        });
        if (material.map) material.map.anisotropy = anisotropy;
        converted.set(source, material);
        return material;
      };
      root.traverse((object) => {
        if (!object.isMesh) return;
        if (!object.geometry.attributes.normal)
          object.geometry.computeVertexNormals();
        object.material = Array.isArray(object.material)
          ? object.material.map(convert)
          : convert(object.material);
      });
      for (const source of converted.keys()) source.dispose();
    },
    resize(width, height, ratio) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
      frameCamera(true);
    },
    render(dt, state) {
      shadow.material.uniforms.uOpacity.value = 0.35 * (1 - state.spread * 0.8);
      if (bloomPass.strength > 0) composer.render(dt);
      else renderer.render(scene, camera);
    },
  };
}
