// 临时自定义报告,只用来冒烟验证 niceeval/report 的 AttemptAssertions 组件能正确显示
// 计分制的 .points 挣分与 t.score 给分记录(默认 AttemptDetail 在有源码能力时优先选
// AttemptSource,不便直接观察 AttemptAssertions 的输出)。用完即删,不是长期报告。
import { AttemptAssertions, AttemptSummary, ExperimentComparison, defineReport } from "niceeval/report";

export default defineReport({
  pages: [
    { id: "report", title: "Report", content: <ExperimentComparison /> },
    {
      id: "attempt",
      title: "Scoring smoke",
      input: "attempt",
      navigation: false,
      content: (
        <>
          <AttemptSummary />
          <AttemptAssertions />
        </>
      ),
    },
  ],
});
