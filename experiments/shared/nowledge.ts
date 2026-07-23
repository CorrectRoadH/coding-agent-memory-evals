import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
 * 启停是一个工厂 `nowledgeLifecycle()`:每个实验文件各自 `const nowledge = nowledgeLifecycle();`,
 * 拿到一套共享同一闭包的 `{ endpoint, setup, teardown, sandboxSetup }`。`setup` 在本实验第一个
 * attempt 前激活一个全新 mem 实例(容器+隧道,经 scripts/nowledge-mem.sh up)并把连接信息存进
 * 工厂闭包;`teardown` 在全部 attempt 收尾后 best-effort probe 再 down 反激活。claude 与 codex
 * 两个 nowledge 实验同批跑时各持一份工厂实例,坐标互不覆写——`pnpm exec niceeval exp compare`
 * 一条命令跑齐,无需 wrapper。
 *
 * 与 mempal 不同,记忆态在中心化 server 上跨 attempt 天然共享:没有 checkpoint 存取,
 * 但并行 attempt 会读写同一个库。实验声明 maxConcurrency: 1 串行,让累积顺序确定。
 */

// 实例状态根目录:每个实例一个子目录(env / port / cloudflared.pid / owner),由
// scripts/nowledge-mem.sh up 创建、down 删除——目录存在即「实例还没被反激活」,是 teardown
// 跨进程找回孤儿的持久化台账(niceeval 恢复契约:补执行是新进程语义,闭包不可依赖)。
const CACHE_DIR = fileURLToPath(new URL("../../.cache/nowledge-mem", import.meta.url));

// default 实例的 env(手动 `scripts/nowledge-mem.sh up` 的调试流,不经 niceeval setup 时的兜底)。
const ENV_FILE = join(CACHE_DIR, "default", "env");

const CTL = fileURLToPath(new URL("../../scripts/nowledge-mem.sh", import.meta.url));
const execFileAsync = promisify(execFile);

/** 与 scripts/nowledge-mem.sh 的镜像 tag 及沙箱内 nmem-cli 版本对齐。 */
export const NOWLEDGE_VERSION = "0.10.29";

export interface NowledgeEnv {
  url: string;
  apiKey: string;
}

/**
 * 手动调试流的兜底:进程 env → default 实例 env 文件(`scripts/nowledge-mem.sh up` 写的)。
 * 只在没有通过 `nowledgeLifecycle().setup` 走实验级激活时使用(例如手动起 default 实例后
 * 直接调用本文件的 helper 排障);正常的 `niceeval exp` 路径下,工厂闭包里的连接信息在
 * 任何消费者读取前就已经就绪,用不到这条兜底链。
 */
function loadNowledgeEnv(): NowledgeEnv | undefined {
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
  "[nowledge] 缺 NMEM_URL / NMEM_API_KEY:实验挂 nowledgeLifecycle() 的 setup/teardown" +
  "(niceeval 自动激活/反激活实例);手动调试可 scripts/nowledge-mem.sh up 起 default 实例" +
  "(quick tunnel URL 每次重启会变)。";

/** nowledge-mem.sh 的一个子命令;stderr 原样透传成 setup 进度不可行(niceeval 只收结构化
 *  progress),失败时截尾部进错误消息。可选 timeoutMs 覆盖默认的 600s(teardown 里的 probe
 *  是观测,用短超时,失败不该挡在 down 前面)。 */
async function nowledgeCtl(command: string, instance: string, opts?: { timeoutMs?: number }): Promise<void> {
  try {
    await execFileAsync("bash", [CTL, command, instance], { timeout: opts?.timeoutMs ?? 600_000 });
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

/** 报告分组用的实验事实。 */
export function nowledgeFlags(): Record<string, string> {
  return { memory: "nowledge", nowledgeVersion: NOWLEDGE_VERSION };
}

/** 实例名的实验前缀;setup 起名与 teardown 扫孤儿必须用同一个投影。 */
function instancePrefix(experimentId: string): string {
  return `exp-${experimentId.replace(/[^A-Za-z0-9]+/g, "-")}-`;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从状态目录台账找回本实验的遗留实例:目录名带实验前缀、owner pid 已死(或没有 owner 文件,
 * 兼容本修复之前泄漏的旧孤儿)的都是待收尾的孤儿;owner pid 仍存活的属于并发 run,不触碰——
 * 与 niceeval 收尾登记「pid 不存活才是遗留义务」同一判据。
 */
function listOrphanInstances(prefix: string, exclude?: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(CACHE_DIR);
  } catch {
    return [];
  }
  const orphans: string[] = [];
  for (const name of entries) {
    if (!name.startsWith(prefix) || name === exclude) continue;
    let ownerPid: number | undefined;
    try {
      ownerPid = Number.parseInt(readFileSync(join(CACHE_DIR, name, "owner"), "utf8").trim(), 10) || undefined;
    } catch {
      ownerPid = undefined;
    }
    if (ownerPid !== undefined && pidAlive(ownerPid)) continue;
    orphans.push(name);
  }
  return orphans;
}

/**
 * 极端形态兜底:状态目录被手工清掉、容器还在跑(正是孤儿容器把宿主 loadavg 顶爆的形态)。
 * 活着的实例必有状态目录(up 创建、down 才删),所以「名字带本实验前缀 + 无状态目录」的容器
 * 一定是孤儿,直接 rm -f;隧道 pid 文件已随目录丢失,cloudflared 残留不在此兜底范围。
 */
async function pruneDirlessContainers(prefix: string): Promise<string[]> {
  const namePrefix = `nowledge-mem-${prefix}`;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("docker", ["ps", "-a", "--filter", `name=^${namePrefix}`, "--format", "{{.Names}}"]));
  } catch {
    return []; // docker 不可用时这条兜底自然也无从谈起
  }
  const pruned: string[] = [];
  for (const name of stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const instanceName = name.slice("nowledge-mem-".length);
    if (existsSync(join(CACHE_DIR, instanceName))) continue; // 有台账的走 listOrphanInstances 的 owner 判据
    await execFileAsync("docker", ["rm", "-f", name]);
    pruned.push(name);
  }
  return pruned;
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
 * 启停一份代码;实例、连接坐标每实验一份 —— 工厂在 import 期只创建闭包,不做 I/O,
 * 硬失败留给 `setup`。运行时坐标活在工厂闭包里,不放模块级单例:同批并行的 claude / codex
 * 两个 nowledge 实验各持一份,互不覆写。
 */
export function nowledgeLifecycle() {
  let instance: string | undefined;
  let env: NowledgeEnv | undefined;

  return {
    /** agent / MCP 工厂经它读连接信息:闭包值,setup 之后才存在;未经 setup 直接调用时
     *  退回 loadNowledgeEnv() 的手动调试兜底,再拿不到就报出缺 env 的提示。 */
    endpoint(): NowledgeEnv {
      const resolved = env ?? loadNowledgeEnv();
      if (!resolved) throw new Error(MISSING_ENV_HINT);
      return resolved;
    },

    /**
     * 实验级生命周期(ExperimentDef.setup):激活一个全新 mem 实例(容器+隧道,全新记忆库),
     * 连接信息写进工厂闭包供同实验文件的 sandbox 钩子 / MCP 工厂读取。激活失败时 niceeval
     * 把本实验全部 attempt 记 errored(experiment-setup-failed),不污染同批。
     */
    async setup(ctx: ExperimentHookContext) {
      // 实例名带实验 id 与时间戳:并发跑多个实验互不干扰,残留也可辨认
      instance = `${instancePrefix(ctx.experimentId)}${Date.now()}`;
      ctx.progress({ message: `[nowledge] activating mem instance ${instance}` });
      await nowledgeCtl("up", instance);
      // owner 台账:teardown 的孤儿判据是「owner pid 已死」,并发 run 的活实例靠它免于误清
      writeFileSync(join(CACHE_DIR, instance, "owner"), String(process.pid));
      env = readInstanceEnv(instance);
      ctx.progress({ message: `[nowledge] mem ready → ${env.url}` });
    },

    /**
     * 实验级生命周期(ExperimentDef.teardown):正常路径先 best-effort probe(写路径落库验证,
     * 短超时、中断时跳过,不该挡住拆容器)再 down 自己这份实例(必达底线,try/finally 保证
     * probe 无论成败都执行)。之后**总是**按状态目录台账扫本实验前缀的遗留孤儿逐个 down——
     * 恢复路径(启动自愈 / `--teardown`)闭包里没有 instance,靠的就是这一段;正常路径顺带
     * 自愈历史泄漏。owner pid 仍存活的实例属于并发 run,不触碰。孤儿 down 失败聚合抛出,
     * 落成 experiment-teardown-failed 可见,不静默吞。
     */
    async teardown(ctx: ExperimentHookContext) {
      if (instance) {
        try {
          if (!ctx.signal?.aborted) {
            await nowledgeCtl("probe", instance, { timeoutMs: 10_000 }).catch(() => {});
          }
        } finally {
          await nowledgeCtl("down", instance);
        }
      }

      const failures: string[] = [];
      for (const orphan of listOrphanInstances(instancePrefix(ctx.experimentId), instance)) {
        ctx.progress({ message: `[nowledge] downing orphan instance ${orphan}` });
        try {
          await nowledgeCtl("down", orphan);
        } catch (e) {
          failures.push(`${orphan}: ${(e as Error).message}`);
        }
      }
      try {
        for (const name of await pruneDirlessContainers(instancePrefix(ctx.experimentId))) {
          ctx.progress({ message: `[nowledge] removed dirless orphan container ${name}` });
        }
      } catch (e) {
        failures.push(`dirless-container prune: ${(e as Error).message}`);
      }
      if (failures.length > 0) {
        throw new Error(`[nowledge] orphan cleanup failed (${failures.length}): ${failures.join("; ")}`);
      }
    },

    /**
     * 每沙箱一次:装 nmem CLI 并指向宿主机隧道。跑在 agent.setup 之前,这样 postSetup 里
     * 插件的 install_hooks.py 能从 nmem client 配置读到远程连接。
     */
    sandboxSetup(): SandboxHook {
      return async (sb, ctx) => {
        const conn = env ?? loadNowledgeEnv();
        if (!conn) throw new Error(MISSING_ENV_HINT);

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
        await requireCommand(sb, `server probe(${conn.url};挂了重跑 scripts/nowledge-mem.sh up)`, "nmem --json status");
        hookLog(ctx, `[nowledge] nmem client ready → ${conn.url}`);
      };
    },
  };
}

/**
 * 远程 HTTP MCP(读路径)。url/headers 用 getter 惰性求值:实验文件在发现阶段就 import 本模块,
 * 而实例要到实验级 setup 才激活——adapter 在 agent.setup(每 attempt,晚于实验 setup)才读这些
 * 字段,getter 保证读到的是激活后的连接信息。`endpoint` 由调用方传入(即
 * `nowledgeLifecycle()` 实例的 `.endpoint`),缺失时直接抛出 MISSING_ENV_HINT。
 */
export function nowledgeMcpServer(endpoint: () => NowledgeEnv): McpServer {
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

/** codexAgent(...) 的 Nowledge Mem 配置增量;`endpoint` 传 `nowledgeLifecycle()` 实例的 `.endpoint`。 */
export function nowledgeCodexConfig(
  endpoint: () => NowledgeEnv,
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
// events.json 里就能直接搜到 `nmem`,不再需要拆实例前 probe 服务端才能实锤。
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
 * `nmem config mcp show --host codex` 在 nmem client 已指向隧道时总会成功,所以
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
//     CLI 读 `nmem config client` 的 url/api-key —— 正好是 nowledgeLifecycle().sandboxSetup()
//     已指向隧道的那份配置;
//   · 插件根无 .mcp.json,没有 localhost MCP 要覆盖,所以核心记忆环不叠远程 MCP。
//     (MCP 只服务可选的 skills 匹配 find_skills / report_skill_outcome,记忆本身用不到。)
// 因此 claude 变体 = sandboxSetup()(装 nmem CLI + 设 client 指向隧道)+ 装官方插件,句号——
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
