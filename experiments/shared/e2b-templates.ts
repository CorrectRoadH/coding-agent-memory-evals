export type CodingAgentTemplate = "claude-code" | "codex" | "bub";

export const NICEEVAL_E2B_RELEASE = "v0.6.1";

const PUBLIC_TEMPLATES: Record<CodingAgentTemplate, string> = {
  "claude-code": `correctroads-default-team/niceeval-claude-code:${NICEEVAL_E2B_RELEASE}`,
  codex: `correctroads-default-team/niceeval-codex:${NICEEVAL_E2B_RELEASE}`,
  bub: `correctroads-default-team/niceeval-bub:${NICEEVAL_E2B_RELEASE}`,
};

export function agentE2BTemplate(agent: CodingAgentTemplate): string {
  const envName = agent === "claude-code" ? "CLAUDE_E2B_TEMPLATE" : `${agent.toUpperCase()}_E2B_TEMPLATE`;
  return process.env[envName] ?? PUBLIC_TEMPLATES[agent];
}
