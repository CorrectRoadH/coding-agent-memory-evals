import { defineEval } from "niceeval";
import { commandSucceeded, excludes, includes, isDefined, isFalse, isTrue } from "niceeval/expect";

export default defineEval({
  description:
    "next-evals agent-039: infer that request logging needs proxy.ts (Next.js 16 renamed middleware.ts, prompt never says proxy or middleware)",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/agent-039-indirect-proxy");
    await t.sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);

    await t
      .send("Log every request to the console in this Next.js app.")
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles();

    await t.group("proxy.ts exists at root (Next.js 16 convention), no deprecated middleware.ts", () => {
      t.check(src.hasPath(/^proxy\.ts$/), isTrue("proxy.ts exists at workspace root"));
      t.check(src.hasPath(/(^|\/)middleware\.ts$/), isFalse("no deprecated middleware.ts"));
    });

    const proxy = src.find((file) => file.path === "proxy.ts");
    await t.group("proxy.ts exports a proxy() function, not middleware()", () => {
      t.check(proxy, isDefined("proxy.ts readable"));
      t.check(
        proxy?.content ?? "",
        includes(/export\s+(async\s+)?(default\s+)?function\s+proxy|export\s+default\s+async\s+function\s+proxy/),
      );
      t.check(proxy?.content ?? "", excludes(/export\s+(default\s+)?function\s+middleware/));
    });

    await t.group("proxy.ts imports from next/server and logs the request", () => {
      t.check(proxy?.content ?? "", includes(/from\s+['"]next\/server['"]/));
      t.check(proxy?.content ?? "", includes(/console\.log/));
      t.check(proxy?.content ?? "", includes(/request|req|url|pathname|nextUrl/i));
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "build"]), commandSucceeded());
  },
});
