import test from "node:test";
import assert from "node:assert/strict";
import { Timeline } from "../js/animation.js";

const linear = (t) => t;

test("暂停时不推进动画和延迟步骤，恢复后使用同一个时钟", () => {
  const timeline = new Timeline();
  const state = { opacity: 0 };
  let nextStep = false;
  timeline.tween(state, "opacity", 1, 1, linear);
  timeline.after(1, () => {
    nextStep = true;
  });
  timeline.update(0.5);
  assert.equal(state.opacity, 0.5);
  assert.equal(nextStep, false);
  timeline.update(0);
  assert.equal(state.opacity, 0.5);
  assert.equal(nextStep, false);
  timeline.update(0.5);
  assert.equal(state.opacity, 1);
  assert.equal(nextStep, true);
  assert.equal(timeline.active, false);
});

test("快速切换取消尚未执行的文字/散开动作", () => {
  const timeline = new Timeline();
  const state = { opacity: 0 };
  timeline.tween(state, "opacity", 1, 1, linear);
  timeline.after(0.62, () => assert.fail("旧动作不应恢复"));
  timeline.update(0.3);
  timeline.clear();
  timeline.tween(state, "opacity", 0, 1, linear);
  timeline.update(1);
  assert.equal(state.opacity, 0);
  assert.equal(timeline.active, false);
});

test("回调中新建的动画不重复消耗上一段动画的时间", () => {
  const timeline = new Timeline();
  const state = { spread: 0, morph: 0 };
  timeline.tween(state, "spread", 1, 1, linear, () => {
    timeline.tween(state, "morph", 1, 1, linear);
  });
  timeline.update(1);
  assert.equal(state.spread, 1);
  assert.equal(state.morph, 0);
  timeline.update(0.5);
  assert.equal(state.morph, 0.5);
});

test("替换同一属性的动画时从当前值接续", () => {
  const timeline = new Timeline();
  const state = { spread: 0 };
  timeline.tween(state, "spread", 1, 1, linear, () =>
    assert.fail("旧补间已被替换"),
  );
  timeline.update(0.4);
  timeline.tween(state, "spread", 0, 1, linear);
  timeline.update(0.5);
  assert.equal(state.spread, 0.2);
  timeline.update(0.5);
  assert.equal(state.spread, 0);
});

test("回调清空队列时，同帧中已取消的后续步骤不会执行", () => {
  const timeline = new Timeline();
  timeline.after(1, () => timeline.clear());
  timeline.after(1, () => assert.fail("该步骤已被取消"));
  timeline.update(1);
  assert.equal(timeline.active, false);
});
