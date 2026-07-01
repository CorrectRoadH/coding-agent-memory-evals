import { defineExperiment, codexAgent, bubAgent } from "fasteval";

// dev/vercel 组:用 Vercel Sandbox microVM 替换 Docker 作为沙箱后端。
// 动机:Docker 沙箱下 codex 在 repomod / terminal 类 eval 的首次 send 直接返回 failed
// (turn status = failed, 0 tokens),推测是沙箱初始化兼容性问题;Vercel sandbox 作为对照。
export default defineExperiment({
  description: "",
  agent: bubAgent(),
  model: "gpt-5.4-mini",
  sandbox: "vercel",
  // workspaceDir 告诉 eval 往 vercel 沙箱的默认工作目录传 starter 文件(docker/e2b 各自的目录不同)。
  flags: { workspaceDir: "/vercel/sandbox" },
  runs: 1,
  earlyExit: true,
  budget: 2,
  // 串行跑:防止 3 个并发 Vercel session 同时竞争 API 导致各 agent 都超时。
  maxConcurrency: 1,
  // repomod 的 mvn build + terminal 的 pytest 合计可能超 10 分钟;给 20 分钟宽裕。
  timeoutMs: 1200000,
});
