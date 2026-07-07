import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";

// compare 组的另一半:同模型(gpt-5.4)下的 codex,作为「没有 tape 那套记忆机制」的对照。
// bub(tape)在记忆题上若稳定高于 codex,就是 tape 价值的证据。
//
// --agents-md 变体:每个沙箱在 agent setup 时额外写一份 AGENTS.md(codex 原生就读这个),
// 并把 CLAUDE.md 软链到它,方便同批评测里跨 agent 对比同一份说明文字的效果。
const baseAgent = codexAgent();

export default defineExperiment({
  description: "codex · gpt-5.4 · AGENTS.md",
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
  model: "gpt-5.4", // → ctx.model → agents/codex.ts 写进 config.toml 的 model 行
  sandbox: e2bSandbox({ template: "fasteval-agents" }), // 本地 docker 沙箱
  // 代理(base_url + key)走 .env,由 agents/codex.ts 配成自定义 model_provider(wire_api=responses)
  runs: 1,
  earlyExit: false,
  budget: 15,
});
