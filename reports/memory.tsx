import { ExperimentComparison, defineReport } from "niceeval/report";
import { GITHUB_ICON } from "./components/icons.ts";

// 内建报告的内容 + 品牌外壳:标题与 GitHub 链接,报告本体就是官方 ExperimentComparison。
export default defineReport({
  title: { en: "Evaluation of Memory Systems and Tools", "zh-CN": "评估 Memory 系统与工具" },
  links: [
    { label: "GitHub", href: "https://github.com/CorrectRoadH/coding-agent-memory-evals", icon: GITHUB_ICON },
  ],
  // GA4:ReportAsset 只有 {src}(本地路径)/{inline},无法表达 <script async src=外链> 或 data-*,
  // 所以把 gtag.js 外链改写成自举 inline——自己 append 外链脚本再跑 init。
  scripts: [
    {
      inline: `
        (function () {
          var s = document.createElement("script");
          s.async = true;
          s.src = "https://www.googletagmanager.com/gtag/js?id=G-Q30H5WX93X";
          document.head.appendChild(s);
          window.dataLayer = window.dataLayer || [];
          function gtag() { dataLayer.push(arguments); }
          gtag("js", new Date());
          gtag("config", "G-Q30H5WX93X");
        })();
      `,
    },
  ],
  content: <ExperimentComparison />,
});
