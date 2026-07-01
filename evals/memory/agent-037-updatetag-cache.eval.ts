import { defineEval } from "fasteval";
import { commandSucceeded, includes, isDefined, isFalse, isTrue } from "fasteval/expect";

const WORKSPACE = new URL("../../workspaces/agent-037-updatetag-cache/", import.meta.url).pathname;
// experiment 用 flags.workspaceDir 传自己 sandbox 后端的默认工作目录(docker/e2b/vercel 三者不同,
// 见各 experiments/*.ts);没经过 experiment 直跑(如 --agent codex)时没有 flags,兜底 docker 的默认值。
const DEFAULT_WORKSPACE_DIR = "/home/sandbox/workspace";

export default defineEval({
  description: "next-evals agent-037: use updateTag in a Server Action for read-your-own-writes cache invalidation",
  async test(t) {
    const workspaceDir = typeof t.flags.workspaceDir === "string" ? t.flags.workspaceDir : DEFAULT_WORKSPACE_DIR;
    await t.sandbox.uploadDirectory(WORKSPACE, workspaceDir);
    // runner 在 test() 之前已经打过一次空 git 基线;workspace 现在是 test() 里手工上传的,
    // 晚于那次空提交,所以重新 commit 一次,不然 starter 文件会被当成 agent 生成的文件进最终 diff。
    await t.sandbox.runShell('git add -A && git commit -q -m "workspace" --allow-empty || true');
    await t.sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);

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

    t.check(await t.sandbox.runCommand("npm", ["run", "build"]), commandSucceeded());
  },
});
