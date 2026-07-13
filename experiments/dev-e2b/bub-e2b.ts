import { defineExperiment } from "niceeval";
import { bubAgent } from "niceeval/adapter";
import { e2bSandbox } from "niceeval/sandbox";
import { agentE2BTemplate } from "../shared/e2b-templates.ts";

// dev/e2b 组:bub(tape 记忆)跑在 E2B 微 VM 上。
// 用本 team 构建的 Bub 专用模板；配方固定版本并写 NiceEval 安装规格指纹。
// 构建命令见 codex-e2b.ts。
//
// ⚠️ niceeval 的 bub adapter 默认把 BUB_OVERRIDE 钉死在一个 git+ 分支上(修 tape 丢工具调用
// 文本的上游 bug 还没合并,见 memory: bub-tape-assistant-text-drop),这让 BUB_PINNED 恒为
// true,导致 ensureBub 每次都跳过"模板已烘焙"的捷径,走 uv 安装 + checkpoint 缓存那条路。
// 同批多个 attempt 并发起沙箱时,第一个 attempt 装完 checkpoint 后,其余全部在同一瞬间
// 从锁里被唤醒、并发把同一份 checkpoint tar 传进各自沙箱(restoreCheckpoint→uploadFile)——
// 这个 thundering herd 会打爆 e2b 的 API,报 TypeError: fetch failed(见 memory:
// niceeval-timeout-drops-events 旁边新记的 bub 并发坑)。maxConcurrency 压低到 2 把这批
// 并发上传摊开,避免同一时刻扎堆。
export default defineExperiment({
  description: "bub · gpt-5.4-mini · E2B sandbox",
  agent: bubAgent(),
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: agentE2BTemplate("bub") }),
  runs: 1,
  earlyExit: true,
  budget: 2,
  timeoutMs: 1200000,
  maxConcurrency: 2,
});
