import { defineEval } from "fasteval";
import { includes, isDefined, isFalse, isTrue } from "fasteval/expect";

export default defineEval({
  description: "next-evals agent-037: use updateTag in a Server Action for read-your-own-writes cache invalidation",
  workspace: "./workspaces/agent-037-updatetag-cache",
  setup: async (sandbox) => {
    await sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);
  },
  async test(t) {
    await t
      .send(
        "Create a Server Action that creates a new post. The posts list uses cache tags for caching.\n\n" +
          'After creating the post, invalidate the "posts" cache tag. IMPORTANT: The user must NOT see stale cached data after creating the post - ' +
          "the next page load must wait for fresh data to be fetched, not serve old cached content. " +
          "Use the appropriate Next.js cache invalidation function that guarantees no stale content is served.",
      )
      .then((turn) => turn.expectOk());

    const src = await t.sandbox.readSourceFiles();
    const source = src.text();

    await t.group("Server Action imports updateTag from next/cache", () => {
      t.check(source, includes(/import.*updateTag.*from\s+['"]next\/cache['"]/));
    });

    await t.group("Server Action uses 'use server' directive", () => {
      t.check(source, includes(/['"]use server['"];?/));
    });

    await t.group("Server Action calls updateTag() for cache invalidation", () => {
      // 'use server' 与 updateTag() 必须落在同一个文件里(Server Action 内)。
      t.check(
        src.fileMatchingAll([/['"]use server['"];?/, /updateTag\s*\(/]),
        isDefined("a Server Action calls updateTag"),
      );
    });

    await t.group("Does NOT use revalidateTag for read-your-own-writes (should use updateTag)", () => {
      // 在 'use server' 文件里:必须有用 updateTag 的,且不能有只靠 revalidateTag 失效的。
      const serverFiles = src.filter((file) => /['"]use server['"];?/.test(file.content));
      const usesUpdateTag = serverFiles.some((file) => /updateTag\s*\(/.test(file.content));
      const usesOnlyRevalidateTag = serverFiles.some(
        (file) => /revalidateTag\s*\(/.test(file.content) && !/updateTag\s*\(/.test(file.content),
      );
      t.check(usesUpdateTag, isTrue("a Server Action invalidates via updateTag"));
      t.check(usesOnlyRevalidateTag, isFalse("no Server Action relies on revalidateTag-only invalidation"));
    });

    await t.group("Server Action has post creation logic", () => {
      // post 创建逻辑必须在 Server Action 文件里。
      t.check(
        src.fileMatchingAll([/['"]use server['"];?/, /post|create|formData|title|content/i]),
        isDefined("Server Action has post creation logic"),
      );
    });

    t.scriptPassed("build");
  },
});
