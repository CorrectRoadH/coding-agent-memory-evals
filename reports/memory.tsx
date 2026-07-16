import { ExperimentComparison, defineReport } from "niceeval/report";
import { GITHUB_ICON } from "./components/icons.ts";

// 内建报告的内容 + 品牌外壳:标题与 GitHub 链接,报告本体就是官方 ExperimentComparison。
export default defineReport({
  title: { en: "Evaluation of Memory Systems and Tools", "zh-CN": "评估 Memory 系统与工具" },
  links: [
    { label: "GitHub", href: "https://github.com/CorrectRoadH/coding-agent-memory-evals", icon: GITHUB_ICON },
  ],
  // GA4:官方 snippet 直译成 head 声明(niceeval ≥0.8 的结构化 head 通道)。
  head: [
    { tag: "script", attrs: { async: true, src: "https://www.googletagmanager.com/gtag/js?id=G-Q30H5WX93X" } },
    {
      tag: "script",
      children: `
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        gtag("js", new Date());
        gtag("config", "G-Q30H5WX93X");
      `,
    },
  ],
  content: <ExperimentComparison />,
});
