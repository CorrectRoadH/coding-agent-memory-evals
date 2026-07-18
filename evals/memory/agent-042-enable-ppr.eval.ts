import { defineEval } from "niceeval";
import { commandSucceeded, excludes, includes, isDefined } from "niceeval/expect";

export default defineEval({
  description:
    "next-evals agent-042: enable PPR via cacheComponents: true (Next.js 16), not the old experimental.ppr flag",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/agent-042-enable-ppr");
    await t.sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);

    await t
      .send("Enable partial pre-rendering for this app.")
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles();
    const config = src.find((file) => file.path === "next.config.ts");

    await t.group("next.config.ts enables PPR via cacheComponents", () => {
      t.check(config, isDefined("next.config.ts readable"));
      t.check(config?.content ?? "", includes(/cacheComponents\s*:\s*true/));
    });

    await t.group("Does NOT use the old experimental.ppr flag", () => {
      // 剥掉注释再查,免得解释性注释误伤。
      const stripped = (config?.content ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      t.check(stripped, excludes(/ppr\s*:\s*true/));
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "build"]), commandSucceeded());
  },
});
