import { ExperimentComparison, defineReport } from "niceeval/report";
import { GITHUB_ICON } from "./components/icons.ts";

// 内建报告的内容 + 品牌外壳:标题与 GitHub 链接,报告本体就是官方 ExperimentComparison。
export default defineReport({
  title: { en: "Coding Agent Memory Evals", "zh-CN": "Coding Agent 记忆能力评测" },
  links: [
    { label: "GitHub", href: "https://github.com/CorrectRoadH/coding-agent-memory-evals", icon: GITHUB_ICON },
  ],
  content: <ExperimentComparison />,
});
