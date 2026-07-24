import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shared } from "niceeval/adapter";
import type { ClaudeCodeConfig, ClaudeCodePluginSpec, CodexConfig, CodexPluginSpec, McpServer } from "niceeval/adapter";
import type { Sandbox, SandboxHook, SandboxHookContext } from "niceeval/sandbox";

/**
 * Nowledge Mem 记忆条件:固定远程实例。
 *
 * 拓扑:mem 服务端在宿主机外部长期运行(手动管理,如 scripts/nowledge-mem.sh 或任意别处),
 * cloudflared 隧道暴露公网;连接坐标(NMEM_URL / NMEM_API_KEY)固定放仓库 .env(gitignored),
 * niceeval 侧**没有任何生命周期**——不 up、不 down、不 probe、无实验级 setup/teardown。
 * 沙箱钩子只做接线:装 nmem CLI、把 client 指向远程、端到端探活。
 *
 * 这与 mempal 的差异是形态本质:mempal 状态是文件(checkpoint 每 attempt 恢复/回存),
 * nowledge 状态在中心化 server 上跨 attempt / 跨实验 / 跨 run 天然共享持续积累。
 * 由此的两条纪律:
 * - **可重入 ≠ 可并发**:并行 attempt 读写同一个库,实验必须 maxConcurrency: 1 串行,
 *   让记忆累积顺序确定(eval N 读得到 eval N-1 写的)。
 * - **所有 nowledge 实验(含 dev-e2b 冒烟)共用这一个库**:run N 依赖此前所有写入。
 *   正式对比要说清起点库状态;归零 = 在服务端侧清库或换一个实例,然后更新 .env。
 *
 * quick tunnel URL 每次 cloudflared 重启会变:变了只更新 .env,代码与实验文件不动。
 * 写路径观测:随时可在宿主机上 `NMEM_API_KEY=… uvx --from nmem-cli nmem --api-url <url> --json threads list`
 * 查积累量,不再有「拆实例前必须 probe 否则数据没了」的时间窗。
 */

/** 远程服务端 /health 报的版本(记进 flags 做 provenance);服务端升级时更新。 */
export const NOWLEDGE_VERSION = "0.10.39";

export interface NowledgeEnv {
  url: string;
  apiKey: string;
}

const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));

const MISSING_ENV_HINT =
  "[nowledge] 缺 NMEM_URL / NMEM_API_KEY:在仓库 .env(或进程 env)里给出固定远程 mem 实例的" +
  "隧道 URL 与 API key。quick tunnel URL 每次重启会变,重启后更新 .env 即可。";

/**
 * 固定远程连接:进程 env 优先,回退解析仓库 .env(gitignored;兼容带/不带 `export ` 前缀)。
 * 每次调用现读——.env 里换了 URL 不需要重启任何东西。
 */
export function nowledgeEndpoint(): NowledgeEnv {
  let url = process.env.NMEM_URL?.trim();
  let apiKey = process.env.NMEM_API_KEY?.trim();
  if (!url || !apiKey) {
    try {
      for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
        const match = line.match(/^(?:export )?(NMEM_URL|NMEM_API_KEY)=(.+)$/);
        if (match?.[1] === "NMEM_URL") url ||= match[2].trim();
        if (match?.[1] === "NMEM_API_KEY") apiKey ||= match[2].trim();
      }
    } catch {
      // 落到下面的统一报错
    }
  }
  if (!url || !apiKey) throw new Error(MISSING_ENV_HINT);
  return { url: url.replace(/\/+$/, ""), apiKey };
}

/** 报告分组用的实验事实。endpoint 记 URL 做 provenance(隧道 URL 会换,报告里能看出这轮连的哪个);
 *  best-effort:.env 缺失时不让实验发现阶段炸掉,留 "unset" 由沙箱接线时硬失败。 */
export function nowledgeFlags(): Record<string, string> {
  let endpoint = "unset";
  try {
    endpoint = nowledgeEndpoint().url;
  } catch {
    // 沙箱 setup 会硬失败并给出 MISSING_ENV_HINT,这里不重复炸
  }
  return { memory: "nowledge", nowledgeVersion: NOWLEDGE_VERSION, nowledgeEndpoint: endpoint };
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
 * 沙箱级接线(每沙箱一次):装 nmem CLI 并把 client 指向固定远程实例,跑在 agent.setup 之前,
 * 这样 postSetup 里插件的 install_hooks.py 能从 nmem client 配置读到远程连接。
 */
export function nowledgeSandboxSetup(endpoint: () => NowledgeEnv = nowledgeEndpoint): SandboxHook {
  return async (sb, ctx) => {
    const conn = endpoint();

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

    await requireCommand(sb, "nmem client url", `nmem config client set url '${conn.url}'`);
    await requireCommand(sb, "nmem client api-key", `nmem config client set api-key '${conn.apiKey}'`);
    // 端到端探活:隧道挂了在这里死,不浪费 agent.setup 和模型调用
    await requireCommand(sb, `server probe(${conn.url};挂了则服务端/隧道已死,修好后更新 .env)`, "nmem --json status");
    hookLog(ctx, `[nowledge] nmem client ready → ${conn.url}`);
  };
}

/**
 * 远程 HTTP MCP(codex 读路径)。url/headers 用 getter 惰性求值:adapter 在 agent.setup
 * 才读这些字段,届时现读 .env,拿到的总是最新连接。
 */
export function nowledgeMcpServer(endpoint: () => NowledgeEnv = nowledgeEndpoint): McpServer {
  return {
    name: "nowledge-mem",
    get url() {
      return `${endpoint().url}/mcp/`;
    },
    // APP 头对齐插件自带 .mcp.json;Authorization 是隧道公网侧的硬要求(非 loopback 一律 401)
    get headers() {
      return { Authorization: `Bearer ${endpoint().apiKey}`, APP: "Codex" };
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

/** codexAgent(...) 的 Nowledge Mem 配置增量;连接默认取固定远程实例(nowledgeEndpoint)。 */
export function nowledgeCodexConfig(
  endpoint: () => NowledgeEnv = nowledgeEndpoint,
): Pick<CodexConfig, "mcpServers" | "plugins" | "configFile" | "postSetup"> {
  return {
    mcpServers: [nowledgeMcpServer(endpoint)],
    plugins: [nowledgePlugin],
    // [features] plugins = true 必须在 codex plugin add 之前落盘(adapter 先写 configFile 再装 plugin)
    configFile: "configs/codex/nowledge.toml",
    postSetup: [nowledgePostSetup()],
  };
}

// ── CLI-only 变体(诊断用)────────────────────────────────────────────────
// 背景:compare/codex-gpt-5.4--nowledge 实测 8 个 attempt 里只有 1 个真的调用了
// nowledge-mem MCP 工具,其余全零——但 MCP 调用本身是模型工具调用流里可见的事件,
// 唯一不可观测的是 hook(SessionStart/Stop)shell out 到 nmem CLI 那部分。这个变体反过来:
// 彻底不给 MCP,逼 agent 只能自己在 Bash 里敲 `nmem` 命令——如果它敲了,niceeval 的
// events.json 里就能直接搜到 `nmem`,不再需要查服务端才能实锤。
// 用于诊断"低利用率是不是任务本身不像 continuation work",不是要否定官方 MCP 优先的推荐
// (mem.nowledge.co/zh/docs/integrations/codex-cli 明确说 MCP 更顺手、CLI 只是宿主级兜底)。

const MCP_MANAGED_BEGIN = "# BEGIN Nowledge Mem MCP (managed by nowledge-mem-codex-plugin)";
const MCP_MANAGED_END = "# END Nowledge Mem MCP";

/** 覆盖 AGENTS.md 里"优先用 MCP"的默认引导;因为这个变体从没给 MCP,原文档的优先级判断会误导 agent。 */
const CLI_ONLY_OVERRIDE = `## CLI-Only Override (this benchmark environment)

Nowledge Mem MCP tools are NOT installed in this session — \`memory_search\`, \`memory_add\`,
\`thread_search\`, \`thread_fetch_messages\`, \`read_context_bundle\`, \`mem_fs\`, and
\`find_skills\`/\`report_skill_outcome\` do not exist here and will fail if called.

For every memory operation described above in this document, use the \`nmem\` CLI directly via
the shell instead of the MCP tool it names:

- Startup context: \`nmem --json context --source-app codex\` (or \`nmem --json wm read\` for just
  Working Memory)
- Search durable knowledge: \`nmem --json m search "query"\`
- Search prior threads: \`nmem --json t search "query" --limit 5\`
- Save a durable memory: \`nmem --json m add "content" -t "Title" --unit-type decision -l "label" -s codex -i 0.8\`
- Update an existing one: \`nmem --json m update <memory_id> -c "updated content"\`

Everything else in this document about *when* to search or save still applies — only the
mechanism changes from an MCP tool call to an \`nmem\` shell command.
`;

/**
 * install_hooks.py 装完托管 MCP 段之后,把它删掉,逼 codex 只剩 CLI 一条路。
 * `nmem config mcp show --host codex` 在 nmem client 已指向远程时总会成功,所以
 * install_hooks.py 总会写这个块——不能靠"不给 endpoint"跳过,只能装完之后再删。
 * 删除后验证 config.toml 里确实没有残留,再把 override 追加进 AGENTS.md。
 */
export function nowledgeCliOnlyPostSetup(): SandboxHook {
  return async (sb, ctx) => {
    const configFile = '"${CODEX_HOME:-$HOME/.codex}/config.toml"';
    await requireCommand(
      sb,
      "strip managed MCP block",
      `sed -i '/^${MCP_MANAGED_BEGIN}$/,/^${MCP_MANAGED_END}$/d' ${configFile}`,
    );
    await requireCommand(sb, "MCP block gone from config.toml", `! grep -q "mcp_servers.nowledge-mem" ${configFile}`);
    await shared.appendProjectInstruction(sb, CLI_ONLY_OVERRIDE);
    hookLog(ctx, "[nowledge] MCP block stripped — CLI-only mode, AGENTS.md override appended");
  };
}

/** codexAgent(...) 的 CLI-only 变体:装插件 + hooks,但不注册 MCP,读写全走 `nmem` CLI。 */
export function nowledgeCodexCliOnlyConfig(): Pick<CodexConfig, "plugins" | "configFile" | "postSetup"> {
  return {
    plugins: [nowledgePlugin],
    configFile: "configs/codex/nowledge.toml",
    postSetup: [nowledgePostSetup(), nowledgeCliOnlyPostSetup()],
  };
}

// ── Claude Code 侧 ──────────────────────────────────────────────────────────
// codex 集成的所有摩擦(远程 HTTP MCP 表达不了、无 post-agent-setup hook 跑 install_hooks.py、
// hooks 需 --dangerously-bypass-hook-trust)在 claude-code 这里全不存在:
//   · 插件官方 hooks.json 已声明 SessionStart(读)/UserPromptSubmit(读指引)/Stop(写),
//     `claude plugin install` 装上即生效,不需要独立 install 脚本;
//   · 读写两条路径都 shell out 到 nmem CLI(SessionStart→nmem-hook-read.sh、Stop→nmem-hook-save.py),
//     CLI 读 `nmem config client` 的 url/api-key —— 正好是 nowledgeSandboxSetup()
//     已指向远程实例的那份配置;
//   · 插件根无 .mcp.json,没有 localhost MCP 要覆盖,所以核心记忆环不叠远程 MCP。
//     (MCP 只服务可选的 skills 匹配 find_skills / report_skill_outcome,记忆本身用不到。)
// 因此 claude 变体 = nowledgeSandboxSetup()(装 nmem CLI + 设 client 指向远程)+ 装官方插件,句号——
// nowledgeClaudeConfig() 本身不需要连接信息,不接收 endpoint 参数。

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
