// ─────────────────────────────────────────────────────────────────────────────
// 记忆缺口(memory gap)—— 这套件的承重墙,用【真实开发任务】填充
//
// 旧版 eval 的毛病:第 1 轮立约定、第 2 轮就用。这测的是「上下文指令遵从」,
// 不是「记忆」—— 约定还躺在上文里,没有记忆机制的 agent 也能过。
//
// 真正的记忆只有在「植入的事实已经离开实时上下文」时才看得出来。所以每条 eval 是:
//
//     Plant(植入) → Gap(缺口) → Probe(探测)
//
// 【关键:Gap 用真实开发任务,不用合成填充。】
// 对标 next-evals-oss —— 它每个 case 都是真实的编码任务,不靠假问答凑长度。
// 这里的缺口也是一串【真实的、自包含的功能开发】(建组件、加工具函数、调配置…),
// 让整段对话像一次真实的长跑开发:早期定个决定,中间做几件真实的活(决定进入休眠),
// 后面一个真实任务必须把它捞回来。这正是现实里的失败:「很多轮以前定的事,现在忘了」。
//
// 【关键:缺口任务要避开被测决定那条轴(avoid)。】
// 否则就成了「你 1 轮前刚做过同一件事」,而不是「隔了很久还记不记得」。
// 测「日期库」就用建 UI 组件来填;测「具名导出」就用文档 / 配置 / 代码审查来填。
// 每个真实任务用 `touches` 标好它碰哪条轴,realWork 按 avoid 过滤。
// ─────────────────────────────────────────────────────────────────────────────

// 一条「会话线」:t(主会话)和 t.newSession() 返回的对象都满足它。
interface Thread {
  send(text: string): Promise<{ expectOk(): void }>;
}

// 一个真实开发任务碰到的「决定轴」。被测决定落在哪条轴上,缺口就避开哪条。
export type Axis =
  | "component" // 新建 React 组件(牵涉组件命名 / 目录 / 导出风格)
  | "export" // 产生新的导出符号(牵涉具名导出 vs default 的约定)
  | "date" // 牵涉日期 / 时间库
  | "api" // 牵涉后端调用 / 中间件 / 限流
  | "secret" // 牵涉密钥 / 鉴权
  | "state-lib" // 牵涉状态管理【库】的选型(非局部 useState)
  | "fs-convention"; // 牵涉测试 / 类型 / 常量等目录约定

interface RealTask {
  prompt: string;
  touches: Axis[];
}

// 真实开发待办池(next-oss 风格:简洁、真实交付物、跟随既有代码风格)。
// 都是在 react-greeting 这个真实小项目上往前推进的活;不写文件的「代码审查」类也算真实开发活。
export const BACKLOG: RealTask[] = [
  { prompt: "加一个顶部导航栏组件 NavBar,放 Home / About 两个链接。跟随项目现有写法。", touches: ["component", "export"] },
  { prompt: "加一个 Avatar 组件:传入 name,显示首字母的圆形头像。", touches: ["component", "export"] },
  { prompt: "加一个 Divider 组件,渲染一条水平分隔线,支持传入上下间距。", touches: ["component", "export"] },
  { prompt: "加一个 Counter 组件:一个计数和 +/− 两个按钮,用 useState 管理局部状态。", touches: ["component", "export"] },
  { prompt: "加一个 truncate(str, max) 工具函数,超长截断并加省略号,放 src/text.ts。", touches: ["export"] },
  { prompt: "加一个 capitalize(str) 工具函数,首字母大写,放 src/string.ts。", touches: ["export"] },
  { prompt: "在 README 里补一段『本地怎么启动开发』的说明。", touches: [] },
  { prompt: "给 tsconfig 加一个路径别名 @/* → src/*,方便以后导入。", touches: [] },
  { prompt: "审一下 src/App.tsx 的可访问性(语义标签、alt 之类),列出建议就行,先别改。", touches: [] },
  { prompt: "看看现在整体的组件组织,说说哪里以后可以更清晰,先别动手。", touches: [] },
];

/**
 * 真实开发缺口:在同一条会话线上,连着做 `count` 件【真实】开发任务,
 * 让早先植入的事实在真实工作中自然进入休眠、并被挤出实时上下文(对 bub 触发 anchor)。
 *
 * - 这些任务【不做断言】—— 它们是缺口本身,不是被测内容,但每件都得真的跑通(expectOk),
 *   否则缺口没真正形成、后面的探测就不算数。
 * - `avoid` 排除掉被测决定那条轴上的任务,保证缺口是「隔了很久」而不是「刚做过同样的事」。
 *
 * count 默认 5;真正塞满窗口需要的任务数由实验按模型上下文长度调,见套件 README。
 */
export async function realWork(thread: Thread, count = 5, opts: { avoid?: Axis[] } = {}): Promise<void> {
  const avoid = new Set(opts.avoid ?? []);
  const pool = BACKLOG.filter((task) => task.touches.every((axis) => !avoid.has(axis)));
  if (pool.length === 0) throw new Error(`realWork: avoid=${[...avoid]} 把所有任务都排除了,放宽 avoid`);
  for (let i = 0; i < count; i++) {
    const ack = await thread.send(pool[i % pool.length].prompt);
    ack.expectOk();
  }
}
