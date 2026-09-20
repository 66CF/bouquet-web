import test from "node:test";
import assert from "node:assert/strict";
import { createEffects } from "../js/effects.js";

function advance(effects, seconds) {
  for (let i = 0; i < seconds * 60; i++) effects.update(1 / 60);
}

for (const [mode, expected] of Object.entries({
  original: { meshOpacity: 1, particleOpacity: 0, spread: 0, morph: 0 },
  particles: { meshOpacity: 0, particleOpacity: 1, spread: 0, morph: 0 },
  explode: { meshOpacity: 0, particleOpacity: 1, spread: 1, morph: 0 },
  aggregate: { meshOpacity: 0, particleOpacity: 1, spread: 0, morph: 0 },
  text: { meshOpacity: 0, particleOpacity: 1, spread: 0, morph: 1 },
})) {
  test(`${mode} 从原貌出发可完成全部动画阶段`, () => {
    const effects = createEffects();
    effects.run(mode);
    advance(effects, 8);
    for (const [key, value] of Object.entries(expected))
      assert.equal(effects.state[key], value);
    assert.equal(effects.active, false);
  });
}

test("写字过程中切换回原貌，不会被旧延迟动作覆盖", () => {
  for (const time of [0.2, 1.5, 3]) {
    const effects = createEffects();
    effects.run("text");
    advance(effects, time);
    effects.run("original");
    advance(effects, 10);
    assert.equal(effects.state.meshOpacity, 1);
    assert.equal(effects.state.particleOpacity, 0);
    assert.equal(effects.state.morph, 0);
    assert.equal(effects.state.spread, 0);
  }
});

test("流转可循环运行，再次点击停留在当前画面", () => {
  const effects = createEffects();
  effects.run("cycle");
  advance(effects, 50);
  assert.equal(effects.cycling, true);
  assert.equal(effects.active, true);
  assert.equal(effects.run("cycle"), null);
  const frozen = { ...effects.state };
  advance(effects, 20);
  assert.deepEqual(effects.state, frozen);
  assert.equal(effects.cycling, false);
  assert.equal(effects.active, false);
});

test("手动切换会终止自动循环", () => {
  const effects = createEffects();
  effects.run("cycle");
  advance(effects, 4);
  effects.run("aggregate");
  advance(effects, 30);
  assert.equal(effects.cycling, false);
  assert.equal(effects.state.spread, 0);
  assert.equal(effects.state.meshOpacity, 0);
  assert.equal(effects.active, false);
});

test("连笔书写完成后撤去光流覆盖层，并可重新播放", () => {
  const effects = createEffects();
  effects.run("text");
  advance(effects, 2);
  const progress = effects.state.writeProgress;
  assert.equal(effects.state.writing, 1);
  effects.run("text");
  assert.equal(
    effects.state.writeProgress,
    progress,
    "连续点击不应重置正在运行的光流",
  );
  advance(effects, 6);
  assert.equal(effects.state.writing, 0);
  assert.equal(effects.state.textGlow, 0);
  assert.equal(effects.state.morph, 1);
  effects.run("text");
  assert.equal(effects.state.writeProgress, 0);
  advance(effects, 8);
  assert.equal(effects.state.morph, 1);
  assert.equal(effects.state.writing, 0);
});

test("从光流书写切换到其他模式，会平滑退出且不再落回文字", () => {
  for (const action of [
    "original",
    "particles",
    "explode",
    "aggregate",
    "cycle",
  ]) {
    const effects = createEffects();
    effects.run("text");
    advance(effects, 3);
    effects.run(action);
    assert.equal(effects.state.writing, 1, "中断瞬间保留当前光流，避免闪跳");
    advance(effects, 10);
    assert.equal(effects.state.writing, 0);
    assert.equal(effects.state.morph, 0);
    assert.equal(effects.state.textGlow, 0);
  }
});
