import {
  Col,
  DeltaTable,
  ExperimentComparison,
  FailureList,
  MetricBars,
  MetricScatter,
  ScopeSummary,
  Section,
  Tab,
  Tabs,
  Text,
  assistantTurns,
  costUSD,
  defineReport,
  durationMs,
  endToEndPassRate,
  flag,
  pairsByFlag,
  repeatedFailedCommands,
  tokens,
} from "niceeval/report";

// 记忆条件是实验配置事实，由各 experiment 的 flags 显式声明；报告不解析文件名。
const memoryCondition = flag("memory", { label: "Memory condition" });

export default defineReport({
  title: { en: "Coding Agent Memory Evals", "zh-CN": "Coding Agent 记忆能力评测" },
  links: [{ label: "GitHub", href: "https://github.com/CorrectRoadH/coding-agent-memory-evals" }],
  footer: { en: "Published on every push via Vercel.", "zh-CN": "每次 push 由 Vercel 自动发布。" },
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "总览" },
      content: <ExperimentComparison />,
    },
    {
      id: "memory",
      title: { en: "Memory conditions", "zh-CN": "记忆条件" },
      content: (
        <Col>
          {/* attempt 级计票:一眼看到重试消耗,与总览页的 eval 级计票互补。 */}
          <ScopeSummary votes="attempt" />

          <Tabs>
            <Tab title={{ en: "Pass rate · agent × memory", "zh-CN": "通过率 · agent × 记忆条件" }}>
              <Text>
                每个 agent 三档并排:baseline(无记忆条件)/ agents-md(静态说明文件)/ mempal(可检索记忆,仅
                claude / codex 有此档)。
              </Text>
              <MetricBars rows="agent" columns={memoryCondition} cell={endToEndPassRate} />
            </Tab>
            <Tab title={{ en: "Quality × cost", "zh-CN": "质量 × 成本" }}>
              <Text>同一 agent 不同记忆条件的点——记忆条件是把点往左上(又好又省)推,还是原地不动甚至倒退。</Text>
              <MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />
            </Tab>
          </Tabs>

          <Section title="记忆条件值不值:同 agent 开关对比">
            <Text>
              A→B 是 baseline → 该记忆条件,配对由 flags 机械导出:同可比组、除 memory flag 外配置相同的实验
              自动成对,bub 没有 mempal 档就如实少一对,加新实验不用改本文件。Δ 列同时看 pass rate 涨跌与效率
              (耗时 / assistant turns / token / 重复失败命令 / 成本)——只看 pass rate 会漏掉「少走弯路但没提分」的价值。
            </Text>
            <DeltaTable
              by="experiment"
              pairs={pairsByFlag("memory")}
              metrics={[endToEndPassRate, durationMs, assistantTurns, tokens, repeatedFailedCommands, costUSD]}
            />
          </Section>
        </Col>
      ),
    },
    {
      id: "failures",
      title: { en: "Failures", "zh-CN": "待处理失败" },
      content: <FailureList limit={30} />,
    },
  ],
});
