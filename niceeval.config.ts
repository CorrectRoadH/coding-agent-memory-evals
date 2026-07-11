import { defineConfig } from "niceeval";

export default defineConfig({
  // LLM-as-judge:用代理上的 gpt-5.4-mini(与被测 agent 分离)。
  judge: { model: "gpt-5.4-mini" },

  timeoutMs: 600_000,

  // e2b 账号真实并发沙箱上限实测正好是 20(RateLimitError 精确命中),niceeval 对
  // e2b 的推荐并发默认值也是 20——零 headroom,attempt 释放信号量和旧沙箱实际销毁之间
  // 有重叠窗口,新 attempt 起沙箱瞬间会被限流秒拒。全局压到 8 留够销毁重叠余量。
  // 见 memory: e2b-sandbox-terminated-concurrency。
  maxConcurrency: 8,
});
