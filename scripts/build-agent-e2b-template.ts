import { defaultBuildLogger, Template } from "e2b";
import {
  e2bCodingAgentTemplate,
  type E2BCodingAgent,
} from "niceeval/sandbox/e2b-template";

const agent = process.argv[2] as E2BCodingAgent | undefined;
if (!agent || !["claude-code", "codex", "bub"].includes(agent)) {
  throw new Error("Usage: pnpm template:agent <claude-code|codex|bub> [alias]");
}
const alias = process.argv[3] ?? `memory-evals-${agent}`;

// Project-wide dependencies can be chained here. Claude/Codex extend E2B's official templates;
// Bub uses NiceEval's pinned, fingerprinted recipe.
const template = e2bCodingAgentTemplate(agent)
  .runCmd("git --version && node --version");

const built = await Template.build(template, alias, {
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
});

console.log(`Built ${built.name} (${built.templateId}); use e2bSandbox({ template: ${JSON.stringify(alias)} }).`);
