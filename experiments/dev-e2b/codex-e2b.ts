import { defineExperiment } from "fasteval";
import { codexAgent } from "fasteval/adapter";
import { e2bSandbox } from "fasteval/sandbox";

// dev/e2b 组:用 E2B 微 VM 作为沙箱后端(对照 docker / vercel)。
// 用预制模板 fasteval-agents:4096MB 内存(base 只有 ~481MB,npm install Next.js 依赖会 OOM)
// + 烘焙好 node24 / codex / claude-code / bub,setup 跳过安装。
// 构建:cd fasteval/src/sandbox/templates && e2b template create fasteval-agents \
//        --memory-mb 4096 --cpu-count 2 -c "tail -f /dev/null" --ready-cmd "command -v codex"
export default defineExperiment({
  description: "codex · gpt-5.4-mini · E2B sandbox",
  agent: codexAgent(),
  model: "gpt-5.4-mini",
  sandbox: e2bSandbox({ template: "fasteval-agents" }),
  // workspaceDir 告诉 eval 往 e2b 沙箱的默认工作目录传 starter 文件(docker/vercel 各自的目录不同)。
  flags: { workspaceDir: "/home/user/workspace" },
  runs: 1,
  earlyExit: true,
  budget: 2,
  // repomod 的 build + terminal 的 pytest 合计可能超 10 分钟;给 20 分钟宽裕。
  timeoutMs: 1200000,
});
