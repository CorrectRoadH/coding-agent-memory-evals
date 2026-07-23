import { defineConfig } from "niceeval";

export default defineConfig({
  // LLM-as-judge:用代理上的 gpt-5.4-mini(与被测 agent 分离)。
  judge: { model: "gpt-5.4-mini" },

  timeoutMs: 600_000,

  // e2b 账号真实并发沙箱上限实测正好是 20(RateLimitError 精确命中),niceeval 对 e2b 的
  // 推荐默认值也是 20——零 headroom:attempt 释放信号量和旧沙箱实际销毁之间有重叠窗口,
  // 新 attempt 起沙箱瞬间会被限流秒拒。所以上限一定要留 headroom,别贴着 20 写。
  // 当前取 10 而不是 19:约束已经不是 e2b 配额,而是本机——同批常带 nowledge 这类在 host
  // 侧起 docker server + 隧道的记忆条件,并发再高会把 laptop 压到被 SIGTERM
  // (见 memory: memory-experiments-run-sequential)。纯 e2b、无 host 侧服务的批次可以调高。
  // 另见 memory: e2b-sandbox-terminated-concurrency、niceeval-budget-probe-starves-global-semaphore。
  //
  // 注意这是**全局**上限;实验自己声明的 maxConcurrency 是独立的实验级闸,只串行化本实验,
  // 不钳全局(mempal 的 maxConcurrency: 1 即属此类,实测有效)。
  maxConcurrency: 10,
});
