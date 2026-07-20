# [MemoryBench](https://coding-agent-memory-evals.vercel.app)

[English](README.en.md)

Powered by [NiceEval](https://github.com/CorrectRoadH/NiceEval)

MemoryBench 是一个针对 coding agent **记忆能力**的评测:同一批真实开发任务、同一个模型,只切换 memory 条件,看最终代码、diff、测试和命令是否真的变好。

agent memory 的实现正在快速分化——[Tape](https://tape.systems/)、[Nowledge Mem](https://mem.nowledge.co/)、[mempal](https://github.com/ZhangHanDong/mempal/) 都在解决"agent 会忘"的问题,但目前缺一个可复现的评测来说清楚它们到底有没有用、值不值得多花的 token 和延迟。MemoryBench 就是这个评测。

---

## 测什么

memory 失效分两层，MemoryBench 都测：

- **会话内长程记忆**:前半段的诊断、约束、架构决定,在后半段修 bug / 重构时被忘掉。
- **跨会话持久记忆**:上次讨论过的决定、被否方案、阻塞原因,新 session 里没被带回来。

memory 的作用不做成额外验收项。真实开发里用户关心的是任务是否完成、完成得多快、花费多少、是否少踩坑——如果无 memory 的 agent 也能重新推理并最终通过,那它也应该算过,只是可能更慢、更贵、更不稳定。因此 MemoryBench 实际打的分是:

- **任务完成率**:最终改动能不能通过原始 benchmark 的 verifier。
- **开发效率**:完成同一任务要多少时间、turn、工具调用和 token。
- **重复试错**:是否少走已经探索过的失败路径。

## Memory 条件

| 条件 | 状态 |
|---|---|
| no-memory baseline | 已接入 |
| bub + Tape | 已接入 |
| Codex / Claude Code host memory | 已接入 |
| Nowledge Mem  | 已接入 |


完整候选列表见 [docs/benchmarks.md](docs/benchmarks.md)。

## Quickstart

```sh
git clone https://github.com/CorrectRoadH/MemoryBench.git
cd MemoryBench
pnpm i
pnpm exec niceeval exp compare
```

## Reporting issues

在 [GitHub](https://github.com/CorrectRoadH/memorybench/issues) 上报 eval 定义、memory 条件接线或报告展示的问题。

## 仓库结构

```txt
memorybench/
├─ evals/memory/           # memory / coding task evals
├─ experiments/            # comparable run matrices
│  ├─ shared/              # experimental-condition helpers, not adapter reimplementations
│  └─ compare/
│     ├─ bub-gpt-5.4.ts
│     └─ codex-gpt-5.4.ts
├─ workspaces/             # per-eval starter repos
├─ reports/                # custom NiceEval reports
├─ docs/benchmarks.md      # SWE benchmark survey and candidate evals
└─ niceeval.config.ts      # agents, judge, sandbox defaults
```
