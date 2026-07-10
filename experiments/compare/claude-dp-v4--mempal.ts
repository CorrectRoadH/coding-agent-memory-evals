import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { withMempal } from "../shared/mempal.ts";

// claude-dp-v4 的 mempal 变体:同模型同沙箱,只多一层 mempal 记忆条件 ——
// MCP server(mempal_search / mempal_ingest)+ Stop hook(session 收尾提示存决策)。
// 对照 claude-dp-v4.ts 看 pass 率与效率(时间/token/重复失败命令)的差异。
//
// 前提:mempal 二进制由 setup 从 host 缓存上传(先跑一次
// scripts/build-mempal-linux.sh;见 experiments/shared/mempal.ts 头注)。
// 注意:Stop hook 每 session 会多出一轮「存记忆」,该开销计入本条件的成本,是被测的一部分。
// 记忆按 stateKey 跨 eval / 跨 run 累积(host 侧 .cache/mempal/state/);做干净对照前
// 先 `rm -rf .cache/mempal/state/`,并在报告里注明状态起点(空库/带积累)。
export default defineExperiment({
  description: "claude-code · deepseek-v4-flash · mempal",
  agent: withMempal(
    claudeCodeAgent({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
    }),
    "claude",
    { stateKey: "claude-dp-v4--mempal" },
  ),
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: "fasteval-agents" }),
  runs: 1,
  earlyExit: true,
  budget: 2,
  // 串行跑(niceeval ≥0.4.5 按实验限流,不影响同批基线):attempt 的
  // [载入记忆态 … 回存] 是临界区,声明式串行取代 helper 手写锁。
  maxConcurrency: 1,
  timeoutMs: 1200000,
});
