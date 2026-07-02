import { defineConfig } from "niceeval";

export default defineConfig({
  // LLM-as-judge:用代理上的 gpt-5.4-mini(与被测 agent 分离)。
  judge: { model: "gpt-5.4-mini" },

  timeoutMs: 600_000
});
