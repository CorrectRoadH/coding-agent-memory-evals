import { defineSandboxAgent, requireEnv, shared, createCheckpoint, restoreCheckpoint } from "fasteval";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// bub 的 agent adapter(沙箱型)—— 实验性。
//
// ⚠️ 现实校正(调研结论):bub 不是 npm `@bub/cli`,而是 PyPI 上的 `bub`(alpha,
//    Python 3.12,hook-first AI framework,github.com/bubbuild/bub)。所以:
//    · 安装:用 uv 免 root 装(curl 装 uv → uv tool install bub),不是 npm i -g。
//    · 调用:`bub run "<prompt>" --session-id <id>`,workspace 经顶层 --workspace;
//      没有 --yes / --json / --model 这些 flag(那些是占位时编的)。
//    · 模型 + 代理:纯走 env —— BUB_MODEL=openai:<model>、BUB_API_BASE、BUB_API_KEY。
//    · 会话/记忆:republic 的「tape」(总是开,无 BUB_TAPE_DISABLED 这种开关),
//      落盘在 ~/.bub/tapes/<md5(workspace)[:16]>__<md5(session)[:16]>.jsonl。
//    · 用量/transcript:stdout 没有 JSON,token 在 tape 条目里(kind=event,name=run)。
//
// 注:沙箱是 node:24-slim(无 python),首轮用 uv 现装 python3.12 + bub —— 需要联网,
//    较重。bub 是 alpha,这个 adapter 是「按真实形状」的尽力实现,未完整冒烟。
// ───────────────────────────────────────────────────────────────────────────

const SANDBOX_WORKSPACE = "/home/sandbox/workspace"; // = docker 沙箱 CWD
const BUB_HOME = "/home/node/.bub"; // 绝对路径:sb.readFile 走 `cat <arg>`(不过 shell),~ 不会展开

// checkpoint 路径:uv + Python + bub 工具 venv。注意不包含 .bub(tape 是 per-eval 状态)。
const BUB_CHECKPOINT_PATHS = ["/home/node/.local", "/home/node/.cache/uv"];
// 宿主磁盘持久化位置在下方定义 —— 文件名按完整安装 spec 哈希,改 bub / 插件装源即自动失效。

// 进程内 in-memory 缓存:同一次 fasteval 运行里多个 bub eval 共享,第 2 条起直接 restore。
let memCheckpoint: Buffer | undefined;
// mutex:保证同一时刻只有一个 cold install 在跑,其余等它完成后走 restore。
let installInProgress: Promise<void> | undefined;

// 本地配:走同一个 OpenAI 兼容代理(.env 的 BUB_API_BASE / BUB_API_KEY)。
const auth = () => ({
  BUB_API_KEY: requireEnv("BUB_API_KEY"),
  BUB_API_BASE: requireEnv("BUB_API_BASE"),
});

const UV = "$HOME/.local/bin/uv";
const BUB = "$HOME/.local/bin/bub";

// bub 主包:临时用 fork 分支,带「流式补 stream_options.include_usage」修复 —— 上游流式 completion
// 不带该字段时 OpenAI 兼容 provider 不返回 usage,导致 tape 的 run.usage 恒空、token/cost 恒 0。
// 见 bubbuild/bub#248。
//
// ⚠️ 不能把 fork 当顶层 URL 依赖装(`uv tool install 'git+...bub...'`):otel 插件也依赖 bub,
//    uv 会判 "conflicting URLs for package bub"(即便两个 URL 完全相同)。改用 uv override —— bub
//    顶层用名字、override 把【所有】bub 来源(含插件的依赖)统一强制到 fork,单一来源、无冲突,
//    且 bub-contrib 一行都不用动。等 #248 发版后:删掉 override,顶层改回 'bub>=0.3.0a1'。
const BUB_OVERRIDE = "bub @ git+https://github.com/CorrectRoadH/bub.git@fix/streaming-usage-include-usage";
const BUB_OVERRIDE_FILE = "/tmp/bub-override.txt";

// --with <otel 插件>:把 OTel 插件装进 bub 这个 tool 环境(同环境插件才会被 bub 加载)。
// 用 PR #49 的分支:bub 在 04960b1 用自家 bub.tape 替掉了 republic,旧版插件仍
// `from republic import TapeEntry`,运行时 bub.tape.TapeEntry 过不了 isinstance/pydantic
// 校验 → 每条 append 抛错、导出 0 span(见 bub-contrib#47)。该分支把插件迁到 bub.tape,
// 兼容 bub HEAD,无需钉版本。等 PR 合并进 main 可改回 bubbuild/bub-contrib 主仓。
const OTEL_PLUGIN =
  "git+https://github.com/CorrectRoadH/bub-contrib.git@fix/tapestore-otel-tape-entry-validation" +
  "#subdirectory=packages/bub-tapestore-otel";

// 完整安装 spec(bub 主包 + 插件)。磁盘缓存文件名按它哈希:任一装源变了 → 新文件名 →
// 旧 checkpoint 被忽略 → cold install 重装,无需手动删缓存。
const INSTALL_SPEC = `bub --override(${BUB_OVERRIDE}) --with ${OTEL_PLUGIN}`;
const DISK_CACHE_PATH = join(
  homedir(),
  ".cache",
  "fasteval",
  `bub-checkpoint-${createHash("md5").update(INSTALL_SPEC).digest("hex").slice(0, 12)}.bin`,
);

// 首轮装 uv + bub(免 root,uv 自带下载 python 3.12)。
// 三层策略:
//   1. 进程内 in-memory 缓存(同一次 fasteval 运行内第 2 条 bub eval 直接命中)
//   2. 磁盘持久化缓存(跨进程/跨次运行)
//   3. Cold install + 打快照 → 写盘(mutex 保证只做一次,其余等完再 restore)
async function ensureBub(sb: import("fasteval").Sandbox): Promise<void> {
  // ── 1. in-memory 缓存 ──────────────────────────────────────────────────
  if (memCheckpoint) {
    await restoreCheckpoint(sb, memCheckpoint);
    return;
  }

  // ── 2. 磁盘缓存 ───────────────────────────────────────────────────────
  const disk = await readFile(DISK_CACHE_PATH).catch(() => undefined);
  if (disk) {
    try {
      await restoreCheckpoint(sb, disk);
      memCheckpoint = disk;
      return;
    } catch {
      // 磁盘缓存损坏或不兼容 → 回退 cold install
    }
  }

  // ── 3. Cold install(mutex 串行化:只有一个真正跑,其余等它完成后 restore)──
  if (installInProgress) {
    // 另一个 ensureBub 正在安装,等它完成
    await installInProgress;
    // 此时 memCheckpoint 必已就绪
    if (memCheckpoint) {
      await restoreCheckpoint(sb, memCheckpoint);
      return;
    }
    // 万一还是没有(install 失败了),直接 cold install(不再 mutex,避免死锁)
  }

  // 我是第一个,设 mutex
  let resolveInstall!: () => void;
  let rejectInstall!: (e: unknown) => void;
  installInProgress = new Promise<void>((res, rej) => { resolveInstall = res; rejectInstall = rej; });

  try {
    await sb.runShell(`test -x ${UV} || (curl -LsSf https://astral.sh/uv/install.sh | sh)`);
    // override 文件:把 bub 统一强制到 fork 分支(见 BUB_OVERRIDE 注释)。
    await sb.runShell(`printf '%s\\n' '${BUB_OVERRIDE}' > ${BUB_OVERRIDE_FILE}`);
    let last = { stdout: "", stderr: "" };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const install = await sb.runShell(
        `${UV} tool install --reinstall --python 3.12 --prerelease allow 'bub' --overrides ${BUB_OVERRIDE_FILE} --with '${OTEL_PLUGIN}'`,
      );
      if (install.exitCode === 0) break;
      last = install;
      if (attempt === 3) {
        throw new Error(`bub 安装失败(重试 3 次):\n${(last.stdout + last.stderr).split("\n").slice(-15).join("\n")}`);
      }
    }

    // 打快照,供后续 eval / 下次运行复用
    memCheckpoint = await createCheckpoint(sb, BUB_CHECKPOINT_PATHS);
    await mkdir(dirname(DISK_CACHE_PATH), { recursive: true }).catch(() => {});
    await writeFile(DISK_CACHE_PATH, memCheckpoint).catch(() => {});

    resolveInstall();
  } catch (e) {
    rejectInstall(e);
    installInProgress = undefined;
    throw e;
  }
}

// tape 文件名:md5(resolve(workspace))[:16] + "__" + md5(session_id)[:16](见 bub src/bub/builtin/tape.py)。
// 返回绝对路径(BUB_HOME/tapes/...),否则 sb.readFile 的 `cat ~/...` 读不到。
function tapePath(workspace: string, sessionId: string): string {
  const w = createHash("md5").update(workspace).digest("hex").slice(0, 16);
  const s = createHash("md5").update(sessionId).digest("hex").slice(0, 16);
  return `${BUB_HOME}/tapes/${w}__${s}.jsonl`;
}

export default defineSandboxAgent({
  name: "bub",
  // compactionObservability:tape 的 "anchor" 条目就是压缩检查点(republic 用它缩短历史)。
  // shared.parseBub 目前是通用解析器,未必抠得出 anchor → compactions() 可能返回 0(自动 skip,不误判)。
  // tracing:bub-tapestore-otel 插件把 tape 装饰成 OpenTelemetry span(invoke_agent / agent.step /
  //  chat / execute_tool),经标准 OTEL_EXPORTER_OTLP_TRACES_* env 导出 → view 里看瀑布图。
  capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true, tracing: true },

  // ── agent lifecycle:装 uv + bub,写 AGENTS.md,每个沙箱一次。──
  async setup(sb) {
    await ensureBub(sb);

    // bub 在 system_prompt 钩子里读 workspace/AGENTS.md 并追加到 DEFAULT_SYSTEM_PROMPT。
    // (源码:builtin/hook_impl.py BuiltinImpl._read_agents_file)
    // 仅在 eval workspace 自己没有 AGENTS.md 时注入,避免覆盖 eval 级别的定制。
    if (!(await sb.fileExists(`${SANDBOX_WORKSPACE}/AGENTS.md`))) {
      await shared.writeFile(
        sb,
        `${SANDBOX_WORKSPACE}/AGENTS.md`,
        [
          `You are a coding agent working in a Next.js project at ${SANDBOX_WORKSPACE}.`,
          ``,
          `Implement the requested feature by writing files directly to disk with the available tools:`,
          `- fs_write(path, content): create or overwrite a file`,
          `- fs_edit(path, old, new): edit an existing file`,
          `- bash(cmd): run shell commands`,
          ``,
          `Do NOT respond with only a text explanation — write the actual code files.`,
          `After writing, verify with bash("cd ${SANDBOX_WORKSPACE} && npm run build").`,
        ].join("\n"),
      );
    }
  },

  // ── send 只剩「跑一轮 + 读 tape 解析」。bub 无 resume 概念,靠同一 session-id 续上 tape。──
  async send(input, ctx) {
    const sb = ctx.sandbox;
    const model = ctx.model ?? "gpt-5.4"; // 实验给 ctx.model;无则兜底
    // 关键:bub 的持久记忆 = tape,按 (workspace, session-id) 键(查证 bub 源码:无任何跨 tape 记忆)。
    // eval 的 t.newSession() 语义是「上下文重置、但持久记忆要还在」——对 bub 就是【整条 eval 共用一个 tape】:
    // 用沙箱稳定 id(一个 eval = 一个沙箱),让 tape 跨 newSession 持续,session C 才能记起 session A/B 说过的事。
    // (codex 无此持久存储,它的 newSession = 新 thread、自然遗忘——这正是本套件要对照出的差异。)
    const sessionId = `fe-${sb.sandboxId}`;
    ctx.session.id = sessionId;

    const env = {
      ...auth(),
      BUB_MODEL: `openai:${model}`, // provider:model_id;openai 前缀走 BUB_API_BASE 代理
      BUB_HOME,
      // OTLP traces:只在运行器给了端点时开。bub(Python)的 HTTP 出口只有 protobuf,
      // 走标准 OTEL env;端点要带 /v1/traces 全路径,宿主接收器同时认 protobuf。
      ...(ctx.telemetry?.endpoint
        ? {
            BUB_TAPESTORE_OTEL_ENABLED: "true",
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: ctx.telemetry.endpoint,
            OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
          }
        : {}),
    };
    const escaped = input.text.replace(/'/g, "'\\''");
    // stream: true → bub 的 stdout tee 进容器主日志(`docker logs` 可见)。
    // 注:bub 主要把过程写进 tape(我们另读),stdout 较少;要更全可另 tail tape。
    const res = await sb.runShell(
      `${BUB} --workspace ${SANDBOX_WORKSPACE} run '${escaped}' --session-id ${sessionId}`,
      { env, stream: true },
    );

    // stdout 无 JSON;transcript / 用量都在 tape JSONL 里。
    // 用量:tape 的 run 事件(kind=event,name=run)的 data.usage 带 {prompt_tokens,
    // completion_tokens, prompt_tokens_details.cached_tokens},parseBub 直接抠出。
    // 前提:bub 流式调用要带 stream_options.include_usage —— 否则 OpenAI 兼容 provider 不返回
    // usage、run.usage 恒空(老问题的真因)。已由 BUB_OVERRIDE 的 fork(bubbuild/bub#248)修复。
    // cost:s2a 流式 usage 不带 cost 字段 → 由 fasteval 定价表按 token 估算(estimateCost)。
    const raw = await sb.readFile(tapePath(SANDBOX_WORKSPACE, sessionId)).catch(() => undefined);
    const parsed = shared.parseBub(raw);
    return {
      events: parsed.events,
      usage: parsed.usage,
      status: res.exitCode === 0 ? "completed" : "failed",
    };
  },
});
