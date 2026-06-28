import { defineConfig } from "fastevals";

// 三个 coding-agent(adapter 见 ./agents/*)。
// 都是「沙箱型 agent」:在沙箱里 spawn 各自的 CLI、跨轮 resume、跑完读回 transcript 并解析成标准事件流。
import claudeCode from "./agents/claude-code.js";
import codex from "./agents/codex.js";
import bub from "./agents/bub.js";

export default defineConfig({
  // 注册三个 agent。evals/ 里的 eval「agent 无关」——
  // 同一批 memory eval 用 `fastevals --agent <name>` 分别测三个:
  //   fastevals --agent claude-code
  //   fastevals --agent codex
  //   fastevals --agent bub
  agents: [claudeCode, codex, bub],
  defaultAgent: "claude-code",

  // 沙箱型 agent 的运行环境。本地 docker,零云依赖。
  sandbox: "docker",

  // 被测的「工作项目」:取自 agent-eval 的通用 fixture(一个最小 React/TSX 应用)。
  // session 开始时被拷进沙箱,memory eval 让 agent 在这个真实代码库上干活,
  // 借此观察它是否记住并沿用跨轮 / 跨会话的偏好。单个 eval 可用 `workspace:` 覆盖。
  workspace: "./workspaces/react-greeting",

  // LLM-as-judge 用的评判模型,和被测 agent 完全分离(避免自评)。
  judge: { model: "anthropic/claude-haiku-4-5" },

  // memory 测试天然慢(多轮 + 真实安装/构建),给宽一点。
  timeoutMs: 600_000,
  maxConcurrency: 3,
});
