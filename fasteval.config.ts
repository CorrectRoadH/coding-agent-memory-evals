import { defineConfig } from "fasteval";

// 三个 coding-agent(adapter 见 ./agents/*)。
// 都是「沙箱型 agent」:在沙箱里 spawn 各自的 CLI、跨轮 resume、跑完读回 transcript 并解析成标准事件流。
import claudeCode from "./agents/claude-code.js";
import codex from "./agents/codex.js";
import bub from "./agents/bub.js";

export default defineConfig({
  // 注册三个 agent。evals/ 里的 eval「agent 无关」——
  // 同一批 memory eval 用 `fasteval --agent <name>` 分别测三个:
  //   fasteval --agent claude-code
  //   fasteval --agent codex
  //   fasteval --agent bub
  agents: [claudeCode, codex, bub],
  defaultAgent: "claude-code",

  // 沙箱型 agent 的运行环境。本地 docker,零云依赖。
  sandbox: "docker",

  // 缺省的「工作项目」兜底:一个最小 Next.js App Router 应用(承载 next-oss 风格的真实开发)。
  // 注意:starter repo 是【每条 eval 自己的事】—— 各 eval 在 defineEval({ workspace, setup }) 里声明
  // 自己的 starter 与 prep(不同 eval 可指不同 repo)。这里只是没声明时的兜底默认。
  workspace: "./workspaces/next-app",

  // LLM-as-judge 用的评判模型,和被测 agent 完全分离(避免自评)。
  // 注:本环境只有 s2a 代理(OpenAI 兼容,无 Anthropic key),所以评判模型用代理上的
  // gpt-5.4-mini(便宜、与被测的 gpt-5.4 codex 分离)。judge client 自动复用 CODEX_BASE_URL/KEY。
  // 若要用 Anthropic 评判,在 .env 加 ANTHROPIC_API_KEY 并把 model 改回 anthropic/claude-haiku-4-5。
  judge: { model: "gpt-5.4-mini" },

  // memory 测试天然慢(多轮 + 真实安装/构建),给宽一点。
  timeoutMs: 600_000,
  maxConcurrency: 3,
  // Docker 容器初始化(apt-get install)串行竞争网络/IO;3 个同时起会让第 3 个 apt-get
  // 在 600s 内跑不完 → 限制同时创建沙箱数为 2,错开初始化压力。
  sandboxConcurrency: 2,
});
