import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { ExperimentHookContext } from "niceeval";
import { shared } from "niceeval/adapter";
import type { ClaudeCodeConfig, ClaudeCodePluginSpec, CodexConfig, CodexPluginSpec, McpServer } from "niceeval/adapter";
import type { Sandbox, SandboxHook, SandboxHookContext } from "niceeval/sandbox";

/**
 * Nowledge Mem 记忆条件。
 *
 * 拓扑:宿主机 docker 跑 mem 服务端,cloudflared 隧道暴露公网;沙箱经隧道连——
 * 写路径走插件 lifecycle hooks shell out 到 nmem CLI(读 `nmem config client` 里的 url/api-key);
 * codex 侧读路径另走远程 HTTP MCP(factory `mcpServers` url 形态)。
 *
 * claude 侧实验用 `nowledgeExperimentSetup()`(ExperimentDef.setup):niceeval 在该实验第一个
 * attempt 前激活一个全新 mem 实例(容器+隧道,经 scripts/nowledge-mem.sh up),全部 attempt
 * 收尾后 probe + down 反激活——`pnpm exec niceeval exp compare` 一条命令跑齐,无需 wrapper。
 *
 * 与 mempal 不同,记忆态在中心化 server 上跨 attempt 天然共享:没有 checkpoint 存取,
 * 但并行 attempt 会读写同一个库。实验声明 maxConcurrency: 1 串行,让累积顺序确定。
 */

// default 实例的 env(手动 `scripts/nowledge-mem.sh up` 的调试流);experiment setup 起的
// 实例经模块态 activeEnv 注入,优先级最高,其次进程 env,最后这个文件。
const ENV_FILE = fileURLToPath(new URL("../../.cache/nowledge-mem/default/env", import.meta.url));

const CTL = fileURLToPath(new URL("../../scripts/nowledge-mem.sh", import.meta.url));
const execFileAsync = promisify(execFile);

/** 与 scripts/nowledge-mem.sh 的镜像 tag 及沙箱内 nmem-cli 版本对齐。 */
export const NOWLEDGE_VERSION = "0.10.29";

interface NowledgeEnv {
  url: string;
  apiKey: string;
}

/** nowledgeExperimentSetup 激活的实例连接信息:模块态注入,同进程内所有 nowledge 钩子最优先读它。 */
let activeEnv: NowledgeEnv | undefined;

/**
 * 连接信息:experiment setup 注入的 activeEnv 最优先,其次进程 env,最后读 nowledge-mem.sh
 * 写的 default 实例 env 文件(手动调试流)。拿不到时返回 undefined 而不是抛错——实验文件在
 * `niceeval exp` 发现阶段就会被 import,这里抛错会连累无关实验;真正的硬失败放在
 * experiment setup / attempt 的 sandbox.setup 里。
 */
function loadNowledgeEnv(): NowledgeEnv | undefined {
  if (activeEnv) return activeEnv;
  let url = process.env.NMEM_URL?.trim();
  let apiKey = process.env.NMEM_API_KEY?.trim();
  if (!url || !apiKey) {
    try {
      for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
        const match = line.match(/^export (NMEM_URL|NMEM_API_KEY)=(.+)$/);
        if (match?.[1] === "NMEM_URL") url ||= match[2].trim();
        if (match?.[1] === "NMEM_API_KEY") apiKey ||= match[2].trim();
      }
    } catch {
      return undefined;
    }
  }
  return url && apiKey ? { url: url.replace(/\/+$/, ""), apiKey } : undefined;
}

const MISSING_ENV_HINT =
  "[nowledge] 缺 NMEM_URL / NMEM_API_KEY:claude 侧实验挂 nowledgeExperimentSetup()(niceeval 自动激活/反激活实例);" +
  "手动调试可 scripts/nowledge-mem.sh up 起 default 实例(quick tunnel URL 每次重启会变)。";

/** nowledge-mem.sh 的一个子命令;stderr 原样透传成 setup 进度不可行(niceeval 只收结构化
 *  progress),失败时截尾部进错误消息。 */
async function nowledgeCtl(command: string, instance: string): Promise<void> {
  try {
    await execFileAsync("bash", [CTL, command, instance], { timeout: 600_000 });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const tail = (err.stderr || err.stdout || err.message || "no output").trim().slice(-800);
    throw new Error(`[nowledge] nowledge-mem.sh ${command} ${instance} failed: ${tail}`);
  }
}

function readInstanceEnv(instance: string): NowledgeEnv {
  const envFile = fileURLToPath(new URL(`../../.cache/nowledge-mem/${instance}/env`, import.meta.url));
  let url: string | undefined;
  let apiKey: string | undefined;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^export (NMEM_URL|NMEM_API_KEY)=(.+)$/);
    if (match?.[1] === "NMEM_URL") url = match[2].trim();
    if (match?.[1] === "NMEM_API_KEY") apiKey = match[2].trim();
  }
  if (!url || !apiKey) throw new Error(`[nowledge] 实例 ${instance} 的 env 文件缺 NMEM_URL/NMEM_API_KEY`);
  return { url: url.replace(/\/+$/, ""), apiKey };
}

/**
 * 实验级生命周期(ExperimentDef.setup):激活一个全新 mem 实例(容器+隧道,全新记忆库),
 * 连接信息注入模块态 activeEnv 供同文件的 sandbox.setup / MCP 工厂读取;返回的 teardown
 * 在该实验全部 attempt 收尾后先 probe(写路径落库验证,拆前不查就没了)再 down 反激活。
 * 激活失败时 niceeval 把本实验全部 attempt 记 errored(experiment-setup-failed),不污染同批。
 */
export function nowledgeExperimentSetup() {
  return async (ctx: ExperimentHookContext) => {
    // 实例名带实验 id 与时间戳:并发跑多个实验互不干扰,残留也可辨认
    const instance = `exp-${ctx.experimentId.replace(/[^A-Za-z0-9]+/g, "-")}-${Date.now()}`;
    ctx.progress({ message: `[nowledge] activating mem instance ${instance}` });
    await nowledgeCtl("up", instance);
    activeEnv = readInstanceEnv(instance);
    ctx.progress({ message: `[nowledge] mem ready → ${activeEnv.url}` });
    return async () => {
      activeEnv = undefined;
      // probe 是观测,不该拦 down;失败只损失一条验证信息
      await nowledgeCtl("probe", instance).catch(() => {});
      await nowledgeCtl("down", instance);
    };
  };
}

/** 报告分组用的实验事实。 */
export function nowledgeFlags(): Record<string, string> {
  return { memory: "nowledge", nowledgeVersion: NOWLEDGE_VERSION };
}

function hookLog(ctx: SandboxHookContext, message: string): void {
  ctx.progress({ message });
}

async function requireCommand(sb: Sandbox, label: string, script: string): Promise<void> {
  const result = await sb.runShell(script);
  if (result.exitCode !== 0) {
    const tail = (result.stderr || result.stdout).trim().slice(-500) || "no output";
    throw new Error(`[nowledge] ${label} failed (exit ${result.exitCode}): ${tail}`);
  }
}

/**
 * sandbox.setup:装 nmem CLI 并指向宿主机隧道。跑在 agent.setup 之前,
 * 这样 postSetup 里插件的 install_hooks.py 能从 nmem client 配置读到远程连接。
 */
export function nowledgeSetup(): SandboxHook {
  return async (sb, ctx) => {
    const env = loadNowledgeEnv();
    if (!env) throw new Error(MISSING_ENV_HINT);

    // 插件的 lifecycle hooks 与 install_hooks.py 都要 python3
    await requireCommand(sb, "python3 probe", "command -v python3");

    // nmem-cli 是 ~12MB 的单二进制 wheel,attempt 级安装可接受;uv 优先,pip 兜底
    await requireCommand(
      sb,
      "nmem-cli install",
      "command -v nmem >/dev/null 2>&1 || uv tool install nmem-cli >/dev/null 2>&1 || pip install --user -q nmem-cli",
    );
    // hooks 用 shutil.which("nmem") 找 CLI,别赌 codex 进程的 PATH 含 ~/.local/bin
    await requireCommand(
      sb,
      "nmem on PATH",
      'command -v nmem >/dev/null 2>&1 || { nmem_bin="$HOME/.local/bin/nmem"; test -x "$nmem_bin" && { sudo -n ln -sf "$nmem_bin" /usr/local/bin/nmem 2>/dev/null || ln -sf "$nmem_bin" /usr/local/bin/nmem; }; }; command -v nmem',
    );

    await requireCommand(sb, "nmem client url", `nmem config client set url '${env.url}'`);
    await requireCommand(sb, "nmem client api-key", `nmem config client set api-key '${env.apiKey}'`);
    // 端到端探活:隧道挂了在这里死,不浪费 agent.setup 和模型调用
    await requireCommand(sb, `server probe(${env.url};挂了重跑 scripts/nowledge-mem.sh up)`, "nmem --json status");
    hookLog(ctx, `[nowledge] nmem client ready → ${env.url}`);
  };
}

/**
 * 远程 HTTP MCP(读路径)。url/headers 用 getter 惰性求值:实验文件在发现阶段就 import 本模块,
 * 而实例要到实验级 setup 才激活——adapter 在 agent.setup(每 attempt,晚于实验 setup)才读这些
 * 字段,getter 保证读到的是激活后的连接信息。env 缺失时给占位值——sandbox.setup 会先一步报错。
 */
export function nowledgeMcpServer(): McpServer {
  return {
    name: "nowledge-mem",
    get url() {
      return `${loadNowledgeEnv()?.url ?? "https://nowledge-env-missing.invalid"}/mcp/`;
    },
    // APP 头对齐插件自带 .mcp.json;Authorization 是隧道公网侧的硬要求(非 loopback 一律 401)
    get headers() {
      return { Authorization: `Bearer ${loadNowledgeEnv()?.apiKey ?? ""}`, APP: "Codex" };
    },
  };
}

/** codex 原生插件(skills + lifecycle hooks 声明);sparse 路径对齐 nowledge 官方安装命令。 */
export const nowledgePlugin: CodexPluginSpec = {
  marketplace: {
    name: "nowledge-community",
    source: "nowledge-co/community",
    sparse: [".agents", "nowledge-mem-codex-plugin"],
  },
  name: "nowledge-mem",
};

/**
 * postSetup:跑插件自带的 install_hooks.py——把 Stop hook 装进全局 hooks.json、
 * 确保 [features] hooks 与 hook state 信任块。它检测到 factory 已写的非托管
 * [mcp_servers.nowledge-mem] 段会跳过自己的 managed MCP 块,不会撞出重复 table。
 */
export function nowledgePostSetup(): SandboxHook {
  return async (sb, ctx) => {
    const locate = await sb.runShell(
      'find "${CODEX_HOME:-$HOME/.codex}" -type f -name install_hooks.py -path "*nowledge-mem*" 2>/dev/null | head -1',
    );
    const script = locate.stdout.trim();
    if (!script) throw new Error("[nowledge] 找不到插件的 install_hooks.py——plugin 安装产物不在预期位置");

    await requireCommand(sb, "install_hooks.py", `python3 '${script}'`);

    // nowledge 文档的可选步骤「插件 AGENTS.md 合并进项目根」——对 benchmark 是行为组成部分,
    // 缺了会静默削弱读路径,按硬依赖处理。appendProjectInstruction 只在 AGENTS.md 是
    // adapter 新建时才写 .git/info/exclude,workspace 原有的不排除,零 diff 噪音。
    const agentsMd = await sb.runShell(`cat "$(dirname "$(dirname '${script}')")/AGENTS.md"`);
    if (agentsMd.exitCode !== 0 || !agentsMd.stdout.trim()) {
      throw new Error("[nowledge] 插件目录里找不到 AGENTS.md——插件结构变了,检查合并步骤是否还适用");
    }
    await shared.appendProjectInstruction(sb, agentsMd.stdout);

    // 自查三件套:全局 hooks.json、features.hooks、factory 写入的 MCP 段
    await requireCommand(
      sb,
      "hooks.json present",
      'test -f "${CODEX_HOME:-$HOME/.codex}/hooks.json"',
    );
    await requireCommand(
      sb,
      "mcp_servers.nowledge-mem in config.toml",
      'grep -q "mcp_servers.nowledge-mem" "${CODEX_HOME:-$HOME/.codex}/config.toml"',
    );
    hookLog(ctx, "[nowledge] plugin hooks installed and config verified");
  };
}

/** codexAgent(...) 的 Nowledge Mem 配置增量,实验文件直接展开。 */
export function nowledgeCodexConfig(): Pick<CodexConfig, "mcpServers" | "plugins" | "configFile" | "postSetup"> {
  return {
    mcpServers: [nowledgeMcpServer()],
    plugins: [nowledgePlugin],
    // [features] plugins = true 必须在 codex plugin add 之前落盘(adapter 先写 configFile 再装 plugin)
    configFile: "configs/codex/nowledge.toml",
    postSetup: [nowledgePostSetup()],
  };
}

// ── Claude Code 侧 ──────────────────────────────────────────────────────────
// codex 集成的所有摩擦(远程 HTTP MCP 表达不了、无 post-agent-setup hook 跑 install_hooks.py、
// hooks 需 --dangerously-bypass-hook-trust)在 claude-code 这里全不存在:
//   · 插件官方 hooks.json 已声明 SessionStart(读)/UserPromptSubmit(读指引)/Stop(写),
//     `claude plugin install` 装上即生效,不需要独立 install 脚本;
//   · 读写两条路径都 shell out 到 nmem CLI(SessionStart→nmem-hook-read.sh、Stop→nmem-hook-save.py),
//     CLI 读 `nmem config client` 的 url/api-key —— 正好是 nowledgeSetup() 已指向隧道的那份配置;
//   · 插件根无 .mcp.json,没有 localhost MCP 要覆盖,所以核心记忆环不叠远程 MCP。
//     (MCP 只服务可选的 skills 匹配 find_skills / report_skill_outcome,记忆本身用不到。)
// 因此 claude 变体 = nowledgeSetup()(装 nmem CLI + 设 client 指向隧道)+ 装官方插件,句号。

/**
 * Claude Code 原生插件。marketplace name 必须是 `nowledge-community`(仓库 marketplace manifest
 * 注册的名字,adapter 会回读 `claude plugin marketplace list` 校验),对应官方安装命令
 * `claude plugin install nowledge-mem@nowledge-community`。ref 不钉,与 codex 变体一致取默认分支。
 */
export const nowledgeClaudePlugin: ClaudeCodePluginSpec = {
  marketplace: { name: "nowledge-community", source: "nowledge-co/community" },
  name: "nowledge-mem",
};

/** claudeCodeAgent(...) 的 Nowledge Mem 配置增量;apiKey/baseUrl 等由实验文件自带,这里只叠插件。 */
export function nowledgeClaudeConfig(): Pick<ClaudeCodeConfig, "plugins"> {
  return { plugins: [nowledgeClaudePlugin] };
}
