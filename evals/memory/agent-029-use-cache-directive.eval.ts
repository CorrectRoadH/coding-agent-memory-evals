import { defineEval } from "niceeval";
import { commandSucceeded, excludes, includes, isDefined } from "niceeval/expect";

export default defineEval({
  description: "next-evals agent-029: use cache directive and revalidateTag profile for eventual catalog refresh",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/agent-029-use-cache-directive");
    // runner 在 test() 之前已经打过一次空 git 基线;workspace 现在是 test() 里手工上传的,
    // 晚于那次空提交,所以重新 commit 一次,不然 starter 文件会被当成 agent 生成的文件进最终 diff。
    await t.sandbox.runShell('git add -A && git commit -q -m "workspace" --allow-empty || true');
    await t.sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);

    await t
      .send(
        "You are building an admin product catalog page for an e-commerce team.\n\n" +
          "The catalog is read-heavy and should feel fast for day-to-day browsing, so avoid re-querying product data on every request.\n\n" +
          'Admins can trigger a "Sync latest catalog" action from the page when upstream ERP/PIM data changes (pricing, inventory, availability). ' +
          "After submitting, they should be able to continue working immediately, even if the product list is briefly stale.\n\n" +
          "The expected behavior is that product data is refreshed in the background and becomes up to date shortly after, across any views that depend on the same catalog data.\n\n" +
          "Implement the sync trigger as a regular HTML form that uses an inline Server Action in the page.\n" +
          'Use the cache tag name "products" consistently for catalog caching and invalidation.\n\n' +
          "In practice, sync jobs can touch thousands of SKUs, so operators prioritize a responsive admin experience and eventual consistency across catalog views over forcing every request to block on freshly recomputed data.",
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles();
    const source = src.text();

    await t.group("Catalog reads use use-cache directive and products cache tag", () => {
      t.check(source, includes(/['"]use cache['"];?/));
      t.check(source, includes(/cacheTag\s*\(\s*['"]products['"]\s*\)/));
    });

    await t.group("Page fetches products via lib/db", () => {
      t.check(source, includes(/import.*getAllProducts.*lib\/db|from.*lib\/db/));
      t.check(source, includes(/await\s+getAllProducts\s*\(|getAllProducts\s*\(/));
    });

    await t.group("Inline form-triggered Server Action flow exists", () => {
      // 表单 action={...} + 'use server' + async 必须落在同一个文件里(per-file,不是拼接源码)。
      const inlineActionFile = src.fileMatchingAll([
        /<form[\s\S]*action\s*=\s*\{/,
        /['"]use server['"];?/,
        /async\s+function\s+\w+|const\s+\w+\s*=\s*async\s*\(/,
      ]);
      t.check(inlineActionFile, isDefined("inline form-triggered Server Action exists in one file"));
    });

    await t.group("Server Action revalidates products using revalidateTag profile", () => {
      const revalidateFile = src.fileMatching(/revalidateTag\s*\(/);
      t.check(revalidateFile, isDefined("a file calls revalidateTag"));
      t.check(revalidateFile?.content ?? "", includes(/import.*revalidateTag.*from\s+['"]next\/cache['"]/));
      t.check(revalidateFile?.content ?? "", includes(/revalidateTag\s*\(/));
      t.check(revalidateFile?.content ?? "", includes(/revalidateTag\s*\(\s*['"]products['"]\s*,/));
      t.check(source, excludes(/\bupdateTag\s*\(/));
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "build"]), commandSucceeded());
  },
});
