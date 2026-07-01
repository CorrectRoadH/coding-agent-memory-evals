import { defineExperiment, bubAgent, e2bSandbox } from "fasteval";

// dev/e2b 组:bub(tape 记忆)跑在 E2B 微 VM 上。
// 用预制模板 fasteval-agents:4096MB + 烘焙好 bub(uv 装到 /usr/local/bin),setup 跳过安装。
// 构建命令见 codex-e2b.ts。
export default defineExperiment({
  description: "bub · gpt-5.4-mini · E2B sandbox",
  agent: bubAgent(),
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: "fasteval-agents" }),
  // workspaceDir 告诉 eval 往 e2b 沙箱的默认工作目录传 starter 文件(docker/vercel 各自的目录不同)。
  flags: { workspaceDir: "/home/user/workspace" },
  runs: 1,
  earlyExit: true,
  budget: 2,
  timeoutMs: 1200000,
});
