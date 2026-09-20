// 动画和延迟动作共用可暂停的时钟，切到后台后不会跳过自动演示步骤。
export const EASE = {
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (1 - t) ** 3 * 4),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export class Timeline {
  #jobs = new Set();

  get active() {
    return this.#jobs.size > 0;
  }

  tween(obj, prop, to, duration, ease = EASE.inOutCubic, onComplete) {
    // 同一属性只允许一个补间，快速切换效果时从当前位置接续。
    for (const job of this.#jobs) {
      if (job.obj === obj && job.prop === prop) this.#jobs.delete(job);
    }
    this.#jobs.add({
      obj,
      prop,
      from: obj[prop],
      to,
      duration: Math.max(0.001, duration),
      elapsed: 0,
      ease,
      onComplete,
    });
  }

  after(seconds, onComplete) {
    this.#jobs.add({ duration: seconds, elapsed: 0, onComplete });
  }

  clear() {
    this.#jobs.clear();
  }

  update(dt) {
    // 回调中新建的补间从下一帧开始，不能重复消费当前帧的时间。
    for (const job of [...this.#jobs]) {
      if (!this.#jobs.has(job)) continue;
      job.elapsed += dt;
      const progress = Math.min(1, job.elapsed / job.duration);
      if (job.obj)
        job.obj[job.prop] = job.from + (job.to - job.from) * job.ease(progress);
      if (progress >= 1) {
        this.#jobs.delete(job);
        job.onComplete?.();
      }
    }
  }
}
