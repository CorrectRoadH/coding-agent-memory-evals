import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultBuildLogger, Template } from "e2b";
import { NICEEVAL_PUBLIC_E2B_TEMPLATES } from "niceeval/sandbox/e2b-template";

const projectRoot = resolve(import.meta.dirname, "..");
const binary = ".cache/mempal/mempal";
const agent = process.argv[2];
if (agent !== "claude" && agent !== "codex") {
  throw new Error("Usage: pnpm template:mempal <claude|codex>");
}
const baseTemplate = agent === "claude"
  ? `${NICEEVAL_PUBLIC_E2B_TEMPLATES["claude-code"]}:v0.6.1`
  : `${NICEEVAL_PUBLIC_E2B_TEMPLATES.codex}:v0.6.1`;
const templateName =
  process.env[`MEMPAL_E2B_${agent.toUpperCase()}_TEMPLATE`] ?? `memory-evals-${agent}-mempal`;

await access(resolve(projectRoot, binary)).catch(() => {
  throw new Error(
    `Missing ${binary}. Run \`bash scripts/build-mempal-linux.sh\` before building the E2B template.`,
  );
});

// Extend NiceEval's public, release-pinned Agent template. It derives from E2B's official base,
// while aligning CLI versions across Docker/E2B/Vercel.
const template = Template({ fileContextPath: projectRoot, fileIgnorePatterns: [".git", "node_modules", ".niceeval"] })
  .fromTemplate(baseTemplate)
  .copy(binary, "/usr/local/bin/mempal", { user: "root", mode: 0o755, forceUpload: true })
  .runCmd(
    "set -euo pipefail; " +
      "rm -rf /tmp/mempal-template-warm /home/user/.mempal; " +
      "mkdir -p /tmp/mempal-template-warm; " +
      "printf '%s\\n' 'niceeval template warmup' >/tmp/mempal-template-warm/warmup.md; " +
      "mempal init /tmp/mempal-template-warm; " +
      "mempal ingest /tmp/mempal-template-warm --wing niceeval-template; " +
      "rm -rf /tmp/mempal-template-warm /home/user/.mempal",
    { user: "user" },
  );

const built = await Template.build(template, templateName, {
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
});

console.log(
  `Built ${built.name} (${built.templateId}) from ${baseTemplate}; ` +
    `use e2bSandbox({ template: ${JSON.stringify(templateName)} }).`,
);
