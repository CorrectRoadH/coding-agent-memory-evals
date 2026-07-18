import { defineEval } from "niceeval";
import { commandSucceeded, excludes, includes, isDefined, isTrue } from "niceeval/expect";

export default defineEval({
  description:
    "next-evals agent-033: 403 admin gate via forbidden() from next/navigation with authInterrupts and a forbidden.tsx boundary",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/agent-033-forbidden-auth");
    await t.sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);

    await t
      .send(
        "Create an admin page at /admin that checks if the user has an \"admin\" role in their session. " +
          "If the user is not an admin, return a 403 Forbidden response with a nice error page. " +
          "Use Next.js's built-in auth boundary functions for proper HTTP status codes.",
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles();

    await t.group("next.config enables authInterrupts", () => {
      const config = src.find((file) => file.path === "next.config.ts");
      t.check(config, isDefined("next.config.ts readable"));
      t.check(config?.content ?? "", includes(/authInterrupts\s*:\s*true/));
    });

    const adminPage = src.find((file) => file.path === "app/admin/page.tsx");
    await t.group("Admin page calls forbidden() from next/navigation on role check", () => {
      t.check(adminPage, isDefined("app/admin/page.tsx exists"));
      t.check(adminPage?.content ?? "", includes(/import.*forbidden.*from\s+['"]next\/navigation['"]/));
      t.check(adminPage?.content ?? "", includes(/forbidden\s*\(\s*\)/));
      t.check(adminPage?.content ?? "", includes(/admin|role/i));
    });

    await t.group("forbidden.tsx error boundary exists with proper UI", () => {
      t.check(src.hasPath(/^app\/(admin\/)?forbidden\.tsx$/), isTrue("forbidden.tsx boundary exists"));
      const boundary = src.find((file) => /^app\/(admin\/)?forbidden\.tsx$/.test(file.path));
      t.check(boundary?.content ?? "", includes(/export\s+default\s+function/));
      t.check(boundary?.content ?? "", includes(/403|Forbidden|unauthorized|access/i));
    });

    await t.group("Does NOT redirect for authorization failures", () => {
      t.check(adminPage?.content ?? "", excludes(/redirect\s*\(\s*['"]\/(login|unauthorized)['"]\s*\)/));
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "build"]), commandSucceeded());
  },
});
