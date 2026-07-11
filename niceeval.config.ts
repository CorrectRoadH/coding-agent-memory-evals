import { defineConfig } from "niceeval";

export default defineConfig({
  // LLM-as-judge:用代理上的 gpt-5.4-mini(与被测 agent 分离)。
  judge: { model: "gpt-5.4-mini" },

  timeoutMs: 600_000,

  // e2b 账号真实并发沙箱上限实测正好是 20(RateLimitError 精确命中),niceeval 对
  // e2b 的推荐并发默认值也是 20——零 headroom,attempt 释放信号量和旧沙箱实际销毁之间
  // 有重叠窗口,新 attempt 起沙箱瞬间会被限流秒拒。压到 19 留 1 个 headroom。
  // 见 memory: e2b-sandbox-terminated-concurrency、niceeval-budget-probe-starves-global-semaphore
  // (真正的低并发元凶是 run.ts 的调度 bug,不是这个数字本身;2026-07-11 已在本地
  // niceeval checkout 修掉该 bug——如果 19 仍然撞 RateLimitError,先怀疑 headroom 不够
  // 而不是怀疑调度逻辑又回归)。
  maxConcurrency: 19,
});
