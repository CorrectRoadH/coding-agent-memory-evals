import { defineEval } from "niceeval";
import { commandSucceeded, excludes, includes, isDefined } from "niceeval/expect";

export default defineEval({
  description:
    "next-evals agent-038: refresh the current page from a Server Action via refresh() from next/cache, not redirect or router.refresh",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/agent-038-refresh-settings");
    await t.sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);

    await t
      .send(
        "Create a Server Action that toggles a user's notification preference (on/off). " +
          "After toggling, the current page should refresh to show the updated preference WITHOUT redirecting to a different page. " +
          "Use Next.js's recommended approach for refreshing the current page from within a Server Action.",
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles();
    const source = src.text();

    await t.group("Imports refresh from next/cache", () => {
      t.check(source, includes(/import.*refresh.*from\s+['"]next\/cache['"]/));
    });

    await t.group("Server Action calls refresh()", () => {
      // 'use server' 与 refresh() 必须同文件(Server Action 内)。
      const actionFile = src.fileMatchingAll([/['"]use server['"];?/, /refresh\s*\(\s*\)/]);
      t.check(actionFile, isDefined("a Server Action calls refresh()"));
      t.check(actionFile?.content ?? "", excludes(/redirect\s*\(/));
    });

    await t.group("Server Action has notification toggle logic", () => {
      t.check(
        src.fileMatchingAll([/['"]use server['"];?/, /notification|toggle|preference|setting/i]),
        isDefined("Server Action has toggle logic"),
      );
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "build"]), commandSucceeded());
  },
});
