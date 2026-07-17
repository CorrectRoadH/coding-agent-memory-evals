import {
  AttemptList,
  Col,
  CopyFixPrompt,
  ExperimentComparison,
  Hero,
  ScopeWarnings,
  TraceWaterfall,
  defineReport,
} from "niceeval/report";
import { GITHUB_ICON } from "./components/icons.ts";

// 内建报告的三页(报告 / Attempts / 追踪)逐页照抄 + 品牌外壳:标题与 GitHub 链接。
// 内建页是复制不是 import——换 --report 后每页要不要、长什么样由这个文件自己决定。
export default defineReport({
  title: { en: "Evaluation of Memory Systems and Tools", "zh-CN": "评估 Memory 系统与工具" },
  links: [
    { label: "GitHub", href: "https://github.com/CorrectRoadH/coding-agent-memory-evals", icon: GITHUB_ICON },
  ],
  // GA4:官方 snippet 直译成 head 声明(niceeval ≥0.8 的结构化 head 通道)。
  // react-grab 只在本地 `niceeval view` 时注入,线上构建由 vercel-build.sh 设置 VERCEL=1 挡掉。
  head: [
    ...(process.env.VERCEL
      ? []
      : [
          {
            tag: "script" as const,
            attrs: { src: "https://unpkg.com/react-grab/dist/index.global.js", crossorigin: "anonymous" },
          },
        ]),
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
  pages: [
    {
      id: "report",
      title: { en: "Report", "zh-CN": "报告" },
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <CopyFixPrompt />
          <ExperimentComparison />
        </Col>
      ),
    },
    {
      id: "attempts",
      title: "Attempts",
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <AttemptList filter />
        </Col>
      ),
    },
    {
      id: "traces",
      title: { en: "Traces", "zh-CN": "追踪" },
      content: (
        <Col>
          <Hero />
          <ScopeWarnings />
          <TraceWaterfall />
        </Col>
      ),
    },
  ],
});
