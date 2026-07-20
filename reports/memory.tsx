import { defineReport } from "niceeval/report";
import { standard } from "niceeval/report/built-in";
import { GITHUB_ICON } from "./components/icons.ts";

// 内建 standard 视图整站(报告 / Attempts / 追踪)+ 品牌外壳:标题与 GitHub 链接。
// extends 声明「跟随内建」,niceeval 升级带来的页面演进自动生效。
export default defineReport({
  extends: standard,
  title: { en: "MemoryBench", "zh-CN": "MemoryBench" },
  links: [
    { label: "GitHub", href: "https://github.com/CorrectRoadH/memorybench", icon: GITHUB_ICON },
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
});
