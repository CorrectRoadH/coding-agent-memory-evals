import { defineConfig } from "fasteval";

export default defineConfig({
  sandbox: "docker",

  // LLM-as-judge:用代理上的 gpt-5.4-mini(与被测 agent 分离)。
  judge: { model: "gpt-5.4-mini" },

  timeoutMs: 600_000,
  maxConcurrency: 3,
  sandboxConcurrency: 2,
});
