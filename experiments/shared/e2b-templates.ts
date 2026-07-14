import { NICEEVAL_PUBLIC_E2B_TEMPLATES } from "niceeval/sandbox/e2b-template";

export type CodingAgentTemplate = keyof typeof NICEEVAL_PUBLIC_E2B_TEMPLATES;

/**
 * NiceEval 公共 E2B 模板的 release tag。三个 agent CLI、bub 的安装指纹、系统包全部
 * 烘焙在里面 —— attempt 里零运行时安装。升 niceeval 大版本时同步 bump 这个 tag。
 */
export const NICEEVAL_E2B_RELEASE = "v0.6.1";

/** baseline 实验直接引用公共模板;本仓库不再派生自己的 agent 模板(没有额外依赖要加)。 */
export function agentE2BTemplate(agent: CodingAgentTemplate): string {
  return `${NICEEVAL_PUBLIC_E2B_TEMPLATES[agent]}:${NICEEVAL_E2B_RELEASE}`;
}
