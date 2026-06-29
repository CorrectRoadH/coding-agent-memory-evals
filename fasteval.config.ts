import { defineConfig } from "fasteval";

export default defineConfig({
  // claude-code / codex / bub 已是 fasteval 内置 agent,无需在此注册。
  // 用 `fasteval --agent <name>` 或在 experiment 里直接引用对象即可:
  //   import { bubAgent } from "fasteval";
  defaultAgent: "claude-code",

  sandbox: "docker",

  workspace: "./workspaces/next-app",

  // LLM-as-judge:用代理上的 gpt-5.4-mini(与被测 agent 分离)。
  judge: { model: "gpt-5.4-mini" },

  timeoutMs: 600_000,
  maxConcurrency: 3,
  sandboxConcurrency: 2,
});
