import { Timeline, EASE } from "./animation.js";

export function createEffects() {
  const timeline = new Timeline();
  const tween = (...args) => timeline.tween(...args);
  const state = {
    meshOpacity: 1,
    particleOpacity: 0,
    spread: 0,
    morph: 0, // 0 = 花束形状，1 = 字母 ZWC 形状
    writing: 0,
    writeProgress: 0,
    textGlow: 0,
    spreadMode: 0, // 0 = 爆炸方向（径向），1 = 散射（随机方向）
  };

  let cycling = false;

  function clearPending() {
    cycling = false;
    timeline.clear();
    // 中途切换时保留当前光流位置，再平滑退出覆盖层。
    tween(state, "writing", 0, 0.65);
    tween(state, "textGlow", 0, 0.5);
  }

  function ensureParticlesVisible(quick = false) {
    const dur = quick ? 0.55 : 1.2;
    tween(state, "meshOpacity", 0, dur);
    tween(state, "particleOpacity", 1, dur);
  }

  /* 单个动作：供按钮与自动循环复用 */
  const actions = {
    original() {
      clearPending();
      tween(state, "meshOpacity", 1, 1.1);
      tween(state, "particleOpacity", 0, 1.1);
      tween(state, "spread", 0, 1.1);
      tween(state, "morph", 0, 1.1);
      state.spreadMode = 0;
    },
    particles() {
      clearPending();
      state.spreadMode = 0;
      tween(state, "spread", 0, 1.2);
      tween(state, "morph", 0, 1.4);
      ensureParticlesVisible();
    },
    text() {
      // 连续点击不会把正在书写的光流瞬移回起点；写完后可再次播放。
      if (state.writing > 0 && state.writeProgress < 1) return;
      clearPending();
      state.writeProgress = 0;
      tween(state, "meshOpacity", 0, 1.25, EASE.inOutSine);
      tween(state, "particleOpacity", 1, 0.8, EASE.outCubic);
      tween(state, "writing", 1, 0.8, EASE.inOutSine);
      // 统一进度由 GPU 映射为卷起、盘旋、逐笔汇入三个连续阶段。
      tween(
        state,
        "writeProgress",
        1,
        6.2,
        (t) => t,
        () => {
          state.morph = 1;
          state.spread = 0;
          state.writing = 0;
          state.textGlow = 1;
          tween(state, "textGlow", 0, 1.4, EASE.outCubic);
        },
      );
    },
    explode() {
      clearPending();
      state.spreadMode = 0;
      tween(state, "morph", 0, 1.1);
      if (state.particleOpacity < 0.98 || state.meshOpacity > 0.02) {
        ensureParticlesVisible(true);
        timeline.after(0.62, () => {
          tween(state, "spread", 1, 1.9, EASE.outCubic);
        });
      } else {
        tween(state, "spread", 1, 1.9, EASE.outCubic);
      }
    },
    scatter() {
      clearPending();
      state.spreadMode = 1;
      if (state.particleOpacity < 0.98 || state.meshOpacity > 0.02) {
        ensureParticlesVisible(true);
        timeline.after(0.62, () => {
          tween(state, "spread", 1, 2.1, EASE.inOutSine);
        });
      } else {
        tween(state, "spread", 1, 2.1, EASE.inOutSine);
      }
    },
    aggregate() {
      clearPending();
      ensureParticlesVisible(true);
      tween(state, "spread", 0, 2.2, EASE.inOutCubic);
      tween(state, "morph", 0, 2.2, EASE.inOutCubic);
    },
  };

  /* 自动循环序列：粒子化 → 云 → 爆炸 → 聚合 → 散射 → 聚合 → 还原 */
  const CYCLE = [
    {
      dur: 1.5,
      fn: () => {
        state.spreadMode = 0;
        tween(state, "spread", 0, 0.8);
        tween(state, "morph", 0, 0.8);
        ensureParticlesVisible();
      },
    },
    { dur: 2.0 }, // 粒子云保持
    { dur: 2.2, fn: () => tween(state, "spread", 1, 2.0, EASE.outCubic) },
    { dur: 1.8 }, // 爆炸散开保持
    { dur: 2.4, fn: () => tween(state, "spread", 0, 2.2, EASE.inOutCubic) },
    { dur: 1.3 }, // 聚合保持
    {
      dur: 2.0,
      fn: () => {
        state.spreadMode = 1;
        tween(state, "spread", 1, 1.9, EASE.inOutSine);
      },
    },
    { dur: 1.6 }, // 散射保持
    { dur: 2.4, fn: () => tween(state, "spread", 0, 2.2, EASE.inOutCubic) },
    { dur: 1.5 }, // 再次聚合保持
    {
      dur: 1.4,
      fn: () => {
        tween(state, "particleOpacity", 0, 1.3);
        tween(state, "meshOpacity", 1, 1.3);
      },
    },
    { dur: 1.3 }, // 原貌保持
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
    timeline.after(step.dur, () => cycleStep(i + 1));
  }

  return {
    state,
    get active() {
      return timeline.active;
    },
    get cycling() {
      return cycling;
    },
    update: (dt) => timeline.update(dt),
    stop() {
      cycling = false;
      timeline.clear();
    },
    run(action) {
      if (action === "cycle") {
        if (cycling) {
          cycling = false;
          timeline.clear();
          return null;
        }
        actionCycle();
      } else if (Object.hasOwn(actions, action)) {
        actions[action]();
      } else {
        return null;
      }
      return action;
    },
  };
}
