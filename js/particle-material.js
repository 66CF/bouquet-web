import * as THREE from "three";

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
  uniform float uWriting;
  uniform float uWriteProgress;
  uniform float uTextScale;
  uniform float uTextGlow;
  uniform float uParticleOpacity;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uScaleFactor;
  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;
  uniform vec3 uCameraBack;

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
    // 文字始终使用相机朝向的基向量，旋转场景后也不会镜像或变窄。
    vec3 textBase =
      uCameraRight * aText.x +
      uCameraUp * aText.y +
      uCameraBack * aText.z;
    vec3 base = mix(aHome, textBase, uMorph);
    vec3 pos = base + dir * dist * e;
    // 离开花束时沿弧线旋转，比直线爆炸更像被风吹散的花粉。
    float angle = e * (0.65 + r1 * 0.7);
    mat2 turn = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    pos.xz = mix(pos.xz, turn * pos.xz, e);
    pos.y += sin(e * 3.14159) * dist * (0.12 + r2 * 0.15);

    // 三股不同倾角的光带，在相机平面内卷起，再从左向右落到笔画。
    float p = uWriteProgress;
    float band = floor(aRand * 3.0);
    float along = fract(aRand * 3.0);
    float theta = along * 6.283185 + p * 10.0 + band * 2.094;
    float radius = uTextScale * (0.57 + sin(along * 3.14159) * 0.06);
    vec3 ribbon = vec3(
      cos(theta) * radius,
      sin(theta) * radius * 0.45 + (band - 1.0) * uTextScale * 0.12,
      sin(theta + band) * radius * 0.22
    );
    ribbon.xy += aRandDir.xy * uTextScale * 0.012;
    vec3 orbit = uCameraRight * ribbon.x + uCameraUp * ribbon.y + uCameraBack * ribbon.z;
    float lift = smoothstep(0.015 + r1 * 0.06, 0.27 + r1 * 0.06, p);
    float writingDelay = (aText.x / uTextScale + 0.5) * 0.20 + r2 * 0.045;
    float settle = smoothstep(0.43 + writingDelay, 0.73 + writingDelay, p);
    vec3 writingPosition = mix(mix(pos, orbit, lift), textBase, settle);
    // 粒子落笔时绕过细小弧线，保留手写的流动感。
    writingPosition += uCameraUp * sin(settle * 3.14159) * uTextScale * 0.10 * sin(theta);
    pos = mix(pos, writingPosition, uWriting);
    float textAmount = mix(uMorph, settle, uWriting);
    float arrival = exp(-pow((p - 0.72 - writingDelay) / 0.035, 2.0)) * uWriting;

    // 轻微漂浮，让云层有呼吸感
    float breathing = mix(0.004, 0.00035, textAmount);
    pos.x += sin(uTime * 0.6 + aRand * 6.2831) * breathing;
    pos.y += cos(uTime * 0.45 + r1 * 6.2831) * breathing;
    pos.z += sin(uTime * 0.5 + r2 * 6.2831) * breathing;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.84 + 0.16 * sin(uTime * (0.5 + r1) + r2 * 6.2831);
    // 聚合状态降低叠加亮度，散开后再补偿透明度，保留花瓣颜色层次。
    float densityCompensation = mix(0.7, 0.95, uSpread);
    vAlpha = uParticleOpacity * twinkle * densityCompensation;
    vAlpha *= mix(1.0, 0.32, textAmount);
    vAlpha *= 1.0 + arrival * 1.4 + uTextGlow * 0.5;
    vColor = mix(pow(aColor, vec3(0.8)) * 1.6, vec3(1.3, 0.85, 0.5), 0.12 * e);

    vec3 ink = mix(vec3(1.25, 0.67, 0.48), vec3(1.6, 1.32, 0.87), r1);
    vColor = mix(vColor, ink, max(textAmount, uWriting * lift));

    // 爆炸/散射过程中粒子略微放大，保证散开后仍有光点存在感
    float size = aSize * uSizeScale * (1.0 + 0.8 * uSpread);
    size *= mix(1.0, 0.72, textAmount);
    size *= 1.0 + arrival * 1.5 + uWriting * (1.0 - settle) * step(0.988, r1) * 2.0;
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
    if (d > 1.0) discard;
    float halo = exp(-d * d * 5.0) * (1.0 - smoothstep(0.65, 1.0, d));
    float core = 1.0 - smoothstep(0.0, 0.32, d);
    float alpha = halo * vAlpha;
    vec3 col = vColor * (0.75 + core * 0.8);
    gl_FragColor = vec4(col * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createParticleMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uSpread: { value: 0 },
      uSpreadMode: { value: 0 },
      uSpreadDist: { value: 2.2 },
      uMorph: { value: 0 },
      uWriting: { value: 0 },
      uWriteProgress: { value: 0 },
      uTextScale: { value: 1 },
      uTextGlow: { value: 0 },
      uParticleOpacity: { value: 0 },
      uPixelRatio: { value: pixelRatio },
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
}
