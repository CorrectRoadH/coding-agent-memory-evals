import type { E2BSandboxSpec } from "niceeval/sandbox";

const NEXT_DOCS_RULES = `<!-- BEGIN:nextjs-agent-rules -->
# Use the repository's installed Next.js documentation

If this task touches Next.js and \`node_modules/next/dist/docs/\` exists, read the relevant guide there before writing code. The installed version may differ from your training data; heed its deprecation notices. For non-Next.js tasks, ignore this rule.
<!-- END:nextjs-agent-rules -->
`;

/** Add the static-instructions experimental condition without wrapping an official agent adapter. */
export function withAgentsMd(spec: E2BSandboxSpec): E2BSandboxSpec {
  return spec.setup(async (sb) => {
    await sb.writeFiles({ "AGENTS.md": NEXT_DOCS_RULES });
    const linked = await sb.runCommand("ln", ["-sf", "AGENTS.md", "CLAUDE.md"]);
    if (linked.exitCode !== 0) {
      throw new Error(`agents-md setup failed: ${(linked.stderr || linked.stdout).trim() || "ln exited non-zero"}`);
    }
  });
}
