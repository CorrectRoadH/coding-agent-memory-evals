import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { STANDARD_EVALS } from "../shared/eval-selection.ts";
import { e2bSandbox } from "niceeval/sandbox";

// dev/e2b 组:claude code CLI 接 deepseek 代理(ANTHROPIC_BASE_URL 覆盖),模型 deepseek-v4-flash。
// 使用 E2B 官方 Claude Code template；环境变量可切换到项目派生版本。
//
// --agents-md 变体:agent setup 时额外写一份 AGENTS.md,并把 CLAUDE.md 软链到它
// (与仓库根目录 CLAUDE.md -> AGENTS.md 的方向一致),方便同批评测里跨 agent 对比同一份说明文字的效果。
const baseAgent = claudeCodeAgent({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseUrl: process.env.DEEPSEEK_BASE_URL,
});

export default defineExperiment({
  evals: STANDARD_EVALS,
  description: "claude-code · deepseek-v4-flash · E2B sandbox · AGENTS.md",
  agent: {
    ...baseAgent,
    async setup(sb, ctx) {
      await baseAgent.setup?.(sb, ctx);
      // canary 带 node_modules/next/dist/docs/,AGENTS.md 里引用的路径得真的能读到。
      await sb.runCommand("npm", ["install", "next@canary"]);
      await sb.writeFiles({
        "AGENTS.md": `<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in \`node_modules/next/dist/docs/\` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
`,
      });
      await sb.runCommand("ln", ["-sf", "AGENTS.md", "CLAUDE.md"]);
    },
  },
  model: "deepseek-v4-flash",
  sandbox: e2bSandbox({ template: process.env.CLAUDE_E2B_TEMPLATE ?? "claude" }),
  runs: 1,
  earlyExit: true,
  budget: 2,
  timeoutMs: 1200000,
});
