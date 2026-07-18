import { defineEval } from "niceeval";
import { commandSucceeded, excludes, includes } from "niceeval/expect";

export default defineEval({
  description:
    "next-evals agent-035: opt out of prerendering via connection() from next/server, not unstable_noStore or force-dynamic",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/agent-035-connection-dynamic");
    await t.sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);

    await t
      .send(
        "Create a server component that displays the current server timestamp on each request. " +
          "The timestamp should be different on every page load (not prerendered at build time). " +
          "Use Next.js's recommended approach for opting out of static prerendering when you need dynamic data without using cookies/headers.",
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles();
    const source = src.text();

    await t.group("Component awaits connection() from next/server", () => {
      t.check(source, includes(/import.*connection.*from\s+['"]next\/server['"]/));
      t.check(source, includes(/await\s+connection\s*\(\s*\)/));
    });

    await t.group("Component is async and renders a timestamp", () => {
      t.check(source, includes(/async\s+function|export\s+default\s+async/));
      t.check(source, includes(/new\s+Date\s*\(|Date\.now\s*\(/));
    });

    await t.group("Does NOT use deprecated unstable_noStore", () => {
      // 上游只禁 unstable_noStore;force-dynamic 仅在作为唯一机制时判负,
      // 而 connection() 已被上面的 gate 强制,故不再单独禁。
      t.check(source, excludes(/unstable_noStore/));
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "build"]), commandSucceeded());
  },
});
