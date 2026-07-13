# mempal 记忆条件

## 当前结论

mempal 条件由四个独立部分组成：

1. 两个 Agent 专属 E2B template：分别从 E2B 官方 `claude` / `codex` 派生，预置 mempal 二进制与约 514 MB embedding cache。
2. NiceEval adapter 的 `mcpServers`：把 `mempal serve --mcp` 接给 Claude Code / Codex。
3. agent 行为提示：Claude Code 用 Stop hook；Codex 用本仓库的 `mempal-memory` Skill。原 Codex `cowork-drain` hook 对单 agent 任务是 no-op，已删除。
4. sandbox setup/teardown：做无污染预检，按 cohort 恢复和回存 `$HOME/.mempal`。

旧方案“普通模板 + 每 attempt 上传 14 MB 二进制 + 每 attempt 下载模型”已废弃。实测 E2B 上传曾在 `sb.uploadFile` 报 `TypeError: fetch failed`，而模型预热把 setup 放大到数分钟。稳定、体积大且每次相同的依赖应在模板构建时付一次成本；运行时 hook 只处理按实验变化的状态和验证。

E2B 当前官方 SDK 支持从同 team 已有 template 派生 (`Template().fromTemplate(...)`) 并复制文件、执行构建命令；本仓库据此维护派生模板。参考 [E2B Template 定义](https://e2b.dev/docs/template/defining-template) 与 [构建](https://e2b.dev/docs/template/build)。

## 构建模板

```bash
# 1. host 上产出 linux/amd64 二进制；已存在时自动跳过
bash scripts/build-mempal-linux.sh

# 2. 分别从 E2B 官方 claude / codex template 派生
pnpm template:mempal claude
pnpm template:mempal codex
```

需要换模板名时，构建和运行使用对应的环境变量：

```bash
MEMPAL_E2B_CLAUDE_TEMPLATE=my-claude-template pnpm template:mempal claude
MEMPAL_E2B_CODEX_TEMPLATE=my-codex-template pnpm template:mempal codex
MEMPAL_E2B_CODEX_TEMPLATE=my-codex-template niceeval exp compare/codex-gpt-5.4--mempal
```

模板构建脚本在 `scripts/build-mempal-e2b-template.ts`。它不会在 `pnpm install`、typecheck 或普通 eval 中隐式发布远端资源。

## Attempt 生命周期与 fail-fast

每个 mempal attempt 的相关阶段如下：

```text
E2B 从专用 template provision
  → sandbox.setup
      → command -v mempal（缺失立即报模板配置错）
      → 隔离 HOME 中做 init → ingest → search
      → 启动 MCP 进程并确认可持续运行
      → 恢复 cohort/experiment 对应状态，或严格初始化空库
      → Claude: 安装 Stop hook；Codex: 无 sandbox hook
  → agent.setup
      → adapter 写 MCP 配置
      → Codex 安装 mempal-memory Skill
  → agent run
  → sandbox.teardown
      → 打包状态、原子回存、写 provenance metadata
```

预检使用 `/tmp/mempal-preflight-home`，通过软链复用模板的模型 cache，但不接触正式 palace.db；sentinel 在预检结束时删除，不会污染实验状态。安装、恢复、初始化、hook 权限设置都检查 exit code。只有 teardown 回存是 best-effort：它不能把已经完成的模型任务改判，但会输出诊断。

MCP 是否真正写入 agent 配置属于 adapter 契约；mempal helper 不在 agent.setup 之前猜测 CLI 配置。运行后应从 trace 中核对 `mempal_status`、`mempal_search` 和在确有可复用决策时的 `mempal_ingest`。

## 状态身份与可回顾性

状态路径：

```text
.cache/mempal/state/<MEMPAL_COHORT>/<experimentId>.tgz
.cache/mempal/state/<MEMPAL_COHORT>/<experimentId>.tgz.meta.json
```

`MEMPAL_COHORT` 省略时为 `local`。正式对比必须显式指定一个新的 cohort，并在报告中记录它：

```bash
MEMPAL_COHORT=2026-07-13-clean-a niceeval exp compare
```

metadata 记录 `experimentId`、cohort、字节数、SHA-256 和保存时间，可以确认结果使用了哪份状态。`maxConcurrency: 1` 是必要条件：restore 到 save 是共享状态临界区。

不要把同一道固定答案题跨 run 反复喂给同一 cohort。Skill 和 Stop hook 都明确禁止存储 proposal 编号、hidden-test 猜测、任务最终答案或原始 transcript；更严格的研究设计应使用 train/apply 配对任务，或为每轮评测创建新 cohort。

## 结果有效性

2026-07-10/11 的旧 mempal 对比不能作为效果结论：

- Codex 只有 `mempal_status`，没有 search/ingest，条件实质为 no-op。
- Claude 的跨 run 状态可能包含同题答案，形成污染。
- Codex 的二进制上传失败属于基建错误，不是模型能力。

新结果至少要同时满足：专用模板预检通过、trace 中 MCP 名称可辨识、状态 metadata 可定位、任务没有从同 cohort 的同题答案获益。任务通过率仍是主要指标；memory 的价值看耗时、token、成本、重复失败命令和 pass rate，不加“为了证明记住了”的额外 gate。
