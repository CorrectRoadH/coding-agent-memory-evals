import {
  defineReport,
  defineMetric,
  Col,
  Section,
  Text,
  RunOverview,
  MetricBars,
  DeltaTable,
  MetricScatter,
  AttemptList,
  flag,
  endToEndPassRate,
  durationMs,
  tokens,
  costUSD,
  turns,
} from "niceeval/report";

// 记忆条件是实验配置事实，由各 experiment 的 flags 显式声明；报告不解析文件名。
const memoryCondition = flag("memory", { label: "Memory condition" });

// CLAUDE.md 定的口径:记忆条件的价值要在 elapsed time / tokens / cost / repeated failed
// commands 上体现,不只是 pass rate。前三个是内置指标,重复失败命令内置指标覆盖不到——
// 这才是真正需要 defineMetric 的地方,从 o11y 的 shellCommands 现算。
const repeatedFailedCmds = defineMetric({
  name: "repeated-failed-cmds",
  label: "Repeated failed cmds",
  description:
    "同一条 shell 命令在同一个 attempt 里失败超过一次的次数——agent 是否在反复撞同一个已知失败的命令,记忆条件理应压低这个数。",
  better: "lower",
  unit: "cmds",
  async value(a) {
    if (a.result.verdict === "skipped") return null;
    const o11y = await a.o11y();
    if (!o11y) return null;
    const failCounts = new Map<string, number>();
    for (const c of o11y.shellCommands) {
      if (c.success === false) failCounts.set(c.command, (failCounts.get(c.command) ?? 0) + 1);
    }
    let repeats = 0;
    for (const n of failCounts.values()) if (n > 1) repeats += n - 1;
    return repeats;
  },
});

export default defineReport(async ({ selection }) => {
  const [overview, bars, allAttempts] = await Promise.all([
    RunOverview.data(selection),
    MetricBars.data(selection, {
      rows: "agent",
      columns: memoryCondition,
      cell: endToEndPassRate,
    }),
    AttemptList.data(selection),
  ]);

  // DeltaTable 的 pair 仍负责声明“哪两个具体实验做 A/B”；分组维度来自 flags。
  // bub 没有 --mempal 变体(bub 自带 tape 记忆,--mempal 组只在 claude / codex 上开),
  // 少一对是如实反映现状,不补空对照。
  const selectedExperiments = new Set(selection.snapshots.map((snapshot) => snapshot.experimentId));
  const pairs = [
    { a: "compare/bub-gpt-5.4", b: "compare/bub-gpt-5.4--agents-md", label: "bub · +AGENTS.md" },
    { a: "compare/claude-dp-v4", b: "compare/claude-dp-v4--agents-md", label: "claude · +AGENTS.md" },
    { a: "compare/claude-dp-v4", b: "compare/claude-dp-v4--mempal", label: "claude · +mempal" },
    { a: "compare/codex-gpt-5.4", b: "compare/codex-gpt-5.4--agents-md", label: "codex · +AGENTS.md" },
    { a: "compare/codex-gpt-5.4", b: "compare/codex-gpt-5.4--mempal", label: "codex · +mempal" },
  ].filter(({ a, b }) => selectedExperiments.has(a) && selectedExperiments.has(b));

  const [deltas, frontier] = await Promise.all([
    pairs.length > 0
      ? DeltaTable.data(selection, {
          pairs,
          metrics: [endToEndPassRate, durationMs, turns, tokens, repeatedFailedCmds, costUSD],
        })
      : Promise.resolve(null),
    selectedExperiments.size >= 2
      ? MetricScatter.data(selection, {
          points: "experiment",
          series: "agent",
          x: costUSD,
          y: endToEndPassRate,
        })
      : Promise.resolve(null),
  ]);

  const failures = allAttempts.filter((attempt) => attempt.verdict === "failed" || attempt.verdict === "errored");

  return (
    <Col>
      <RunOverview data={overview} />

      <Section title="Pass rate · agent × memory condition">
        <Text>
          每个 agent 三档并排:baseline(无记忆条件)/ agents-md(静态说明文件)/ mempal(可检索记忆,仅
          claude / codex 有此档)。
        </Text>
        <MetricBars data={bars} />
      </Section>

      {deltas ? (
        <Section title="记忆条件值不值:同 agent 开关对比">
          <Text>
            A→B 是 baseline → 该记忆条件,Δ 列同时看 pass rate 涨跌与效率(耗时 / turns / token / 重复失败命令 /
            成本)——只看 pass rate 会漏掉「记忆条件让 agent 少走弯路但没提分」这种价值,这正是 CLAUDE.md 定的报告口径。
          </Text>
          <DeltaTable data={deltas} />
        </Section>
      ) : null}

      {frontier ? (
        <Section title="Quality × cost frontier">
          <Text>同一 agent 不同记忆条件的点连成线——记忆条件是把频率往右上(又好又省)推,还是原地不动甚至倒退。</Text>
          <MetricScatter data={frontier} />
        </Section>
      ) : null}

      <Section title="失败清单">
        <AttemptList items={failures.slice(0, 30)} total={failures.length} />
      </Section>
    </Col>
  );
});
