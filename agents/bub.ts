import { defineSandboxAgent, requireEnv, shared } from "fastevals";
import { createHash } from "node:crypto";

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

// 本地配:走同一个 OpenAI 兼容代理(.env 的 BUB_API_BASE / BUB_API_KEY)。
const auth = () => ({
  BUB_API_KEY: requireEnv("BUB_API_KEY"),
  BUB_API_BASE: requireEnv("BUB_API_BASE"),
});

const UV = "$HOME/.local/bin/uv";
const BUB = "$HOME/.local/bin/bub";

// 首轮装 uv + bub(免 root,uv 自带下载 python 3.12)。幂等:已装则跳过。
async function ensureBub(sb: import("fastevals").Sandbox): Promise<void> {
  const has = await sb.runShell(`test -x $HOME/.local/bin/bub && echo yes || true`);
  if (has.stdout.includes("yes")) return;
  const install = await sb.runShell(
    `curl -LsSf https://astral.sh/uv/install.sh | sh && ` +
      `${UV} tool install --python 3.12 --prerelease allow 'bub>=0.3.0a1'`,
  );
  if (install.exitCode !== 0) {
    throw new Error(`bub 安装失败:\n${(install.stdout + install.stderr).split("\n").slice(-15).join("\n")}`);
  }
}

// tape 文件名:md5(resolve(workspace))[:16] + "__" + md5(session_id)[:16](见 bub src/bub/builtin/tape.py)。
function tapePath(workspace: string, sessionId: string): string {
  const w = createHash("md5").update(workspace).digest("hex").slice(0, 16);
  const s = createHash("md5").update(sessionId).digest("hex").slice(0, 16);
  return `~/.bub/tapes/${w}__${s}.jsonl`;
}

export default defineSandboxAgent({
  name: "bub",
  // compactionObservability:tape 的 "anchor" 条目就是压缩检查点(republic 用它缩短历史)。
  // shared.parseBub 目前是通用解析器,未必抠得出 anchor → compactions() 可能返回 0(自动 skip,不误判)。
  capabilities: { conversation: true, toolObservability: true, workspace: true, compactionObservability: true },

  async send(input, ctx) {
    const sb = ctx.sandbox;
    await ensureBub(sb);

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
      BUB_HOME: "/home/node/.bub",
    };
    const escaped = input.text.replace(/'/g, "'\\''");
    const res = await sb.runShell(
      `${BUB} --workspace ${SANDBOX_WORKSPACE} run '${escaped}' --session-id ${sessionId}`,
      { env },
    );

    // stdout 无 JSON;transcript / 用量在 tape JSONL 里。
    const raw = await sb.readFile(tapePath(SANDBOX_WORKSPACE, sessionId)).catch(() => undefined);
    const parsed = shared.parseBub(raw);
    return {
      events: parsed.events,
      usage: parsed.usage,
      status: res.exitCode === 0 ? "completed" : "failed",
    };
  },
});
