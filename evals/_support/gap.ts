// ─────────────────────────────────────────────────────────────────────────────
// 记忆缺口(memory gap)—— 这套件的承重墙
//
// 旧版 eval 的毛病:第 1 轮立约定、第 2 轮就用。这测的是「上下文指令遵从」,
// 不是「记忆」—— 一个完全没有记忆机制的 agent 也能过(约定就在上文里)。
//
// 真正的记忆只有在「植入的事实已经离开实时上下文」时才看得出来。所以每条 eval 都是:
//
//     Plant(植入) → Gap(缺口) → Probe(探测)
//
// Gap 段刻意把植入的事实推出上下文窗口,办法有两种(可叠加):
//   1. fillContext(): 灌入一批与约定无关的「只读」干扰轮,把窗口塞满 / 触发压缩。
//   2. t.newSession(): 开一条全新会话线,上下文清零 —— 只有落盘的持久记忆能跨过来。
//
// 跨过缺口还答对的,只可能是真的记住了(对 bub 就是 tape 的 anchor/handoff/search)。
// 这正是 tape 消融实验(experiments/tape-ablation)能测出差异的前提。
//
// 干扰轮全部是「只读问答」,不写文件 —— 这样它们填满了上下文,却不会污染 diff、
// 也不会碰到任何被植入的约定域(样式 / 包管理器 / 导出风格 / 密钥 / 时间库 …)。
// ─────────────────────────────────────────────────────────────────────────────

// 一条「会话线」:t(主会话)和 t.newSession() 返回的对象都满足它。
interface Thread {
  send(text: string): Promise<{ expectOk(): void }>;
}

// 与任何被测约定都不沾边的只读小问题。纯粹用来占满上下文 / 逼出压缩。
// 故意不让它们写文件,以免污染后续的 diff 断言。
export const DISTRACTORS: string[] = [
  "顺便问一下,src/App.tsx 现在大概在做什么?一句话说说就行,别改文件。",
  "TypeScript 里 `interface` 和 `type` 有什么区别?简短回答,不要动代码。",
  "React 的 key 属性是干嘛用的?讲讲就好。",
  "`h1` 标签默认的语义角色是什么?只回答,别改文件。",
  "解释一下什么是受控组件 vs 非受控组件,两三句。",
  "JSX 里为什么用 className 而不是 class?简单说说。",
  "`useMemo` 和 `useCallback` 的区别是什么?别改代码。",
  "TypeScript 的 `unknown` 和 `any` 有什么不同?简短点。",
  "什么是 tree shaking?一句话概括,不用动仓库。",
  "ESM 和 CommonJS 在导入语法上的区别是什么?只讲解。",
  "为什么 React 组件名要大写开头?说说原因就行。",
  "`Promise.all` 和 `Promise.allSettled` 有什么差别?别改文件。",
];

/**
 * 长程缺口:在「同一条会话线」上灌入 `count` 个无关只读干扰轮,
 * 把植入的事实挤出实时上下文(并对 bub 这类有压缩的 agent 触发 anchor)。
 *
 * 这些轮不做任何断言 —— 它们是缺口本身,不是被测内容。
 * count 默认 12;真正塞满窗口需要的轮数由实验按模型上下文长度调,见套件 README。
 */
export async function fillContext(thread: Thread, count = 12): Promise<void> {
  for (let i = 0; i < count; i++) {
    const ack = await thread.send(DISTRACTORS[i % DISTRACTORS.length]);
    ack.expectOk(); // 干扰轮本身得跑通,否则缺口没真正形成,后面的探测就不算数
  }
}
