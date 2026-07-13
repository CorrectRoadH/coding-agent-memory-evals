import { defineExperiment } from "niceeval";
import { e2bSandbox } from "niceeval/sandbox";
import { bubAgent } from "niceeval/adapter";
import { STANDARD_EVALS } from "../shared/eval-selection.ts";

// 文件夹 compare = 唯一一组【可对比】的实验:同一批记忆 eval、同一个模型(gpt-5.4),
// 比 bub(带 tape 记忆)和 codex(无对应持久记忆机制)。`niceeval exp compare` 跑整组。
// 文件名 = <agent>-<model>。bub 默认 tape 开,所以这一个文件就够了(不再要 tape-off 对照)。
//
// --agents-md 变体:agent setup 时额外写一份 AGENTS.md,并把 CLAUDE.md 软链到它
// (与仓库根目录 CLAUDE.md -> AGENTS.md 的方向一致),方便同批评测里跨 agent 对比同一份说明文字的效果。
const baseAgent = bubAgent();

export default defineExperiment({
  evals: STANDARD_EVALS,
  description: "bub · gpt-5.4(tape on) · AGENTS.md",
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
  model: "gpt-5.4", // 两边钉同一个模型,差异才归因到 agent / 记忆机制
  sandbox: e2bSandbox({ template: process.env.BUB_E2B_TEMPLATE ?? "memory-evals-bub" }),
  // 注:workspace(starter repo)上传 + 装依赖不在这儿 —— 那属于「eval 在什么上面干活」,
  // 写在各 eval 的 test(t) 里(t.sandbox.uploadDirectory + runCommand)。experiment 只管怎么跑。
  runs: 1,
  earlyExit: false, // 要完整通过率分布,以便报 pass^k
  budget: 15,
  // 与 claude 组对齐(重型题 mvn build / pytest 可能超 10 分钟),消除条件间超时偏置。
  timeoutMs: 1200000,
});
