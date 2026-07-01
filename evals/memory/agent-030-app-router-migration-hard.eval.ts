import { defineEval } from "fasteval";
import { commandSucceeded, excludes, includes, isTrue } from "fasteval/expect";

const WORKSPACE = new URL("../../workspaces/agent-030-app-router-migration-hard/", import.meta.url).pathname;
// experiment 用 flags.workspaceDir 传自己 sandbox 后端的默认工作目录(docker/e2b/vercel 三者不同,
// 见各 experiments/*.ts);没经过 experiment 直跑(如 --agent codex)时没有 flags,兜底 docker 的默认值。
const DEFAULT_WORKSPACE_DIR = "/home/sandbox/workspace";

export default defineEval({
  description: "next-evals agent-030: migrate a complex Pages Router app to App Router",
  async test(t) {
    const workspaceDir = typeof t.flags.workspaceDir === "string" ? t.flags.workspaceDir : DEFAULT_WORKSPACE_DIR;
    await t.sandbox.uploadDirectory(WORKSPACE, workspaceDir);
    // runner 在 test() 之前已经打过一次空 git 基线;workspace 现在是 test() 里手工上传的,
    // 晚于那次空提交,所以重新 commit 一次,不然 starter 文件会被当成 agent 生成的文件进最终 diff
    // (这个 eval 靠 t.fileDeleted 断言 Pages Router 文件被删,不重新打基线这批断言会全部失真)。
    await t.sandbox.runShell('git add -A && git commit -q -m "workspace" --allow-empty || true');
    await t.sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"]);

    await t
      .send(
        "Migrate every route and file from the Pages Router to the Next.js App Router. " +
          "When finished, remove the pages dir entirely. Ensure the proper App Router APIs are used. " +
          "If a Pages Router API was used that no longer exists in App Router, replace it with the newer version or the new pattern. Make sure to add types.",
      )
      .then((turn) => turn.expectOk());

    const homePage = t.file("app/page.tsx");
    const blogPage = t.file("app/blog/page.tsx");

    await t.group("Root layout exists and replaces _app/_document", async () => {
      t.check(await t.sandbox.fileExists("app/layout.tsx"), isTrue("app/layout.tsx exists"));
      const layout = t.file("app/layout.tsx");
      t.check(layout, includes(/<html.*lang/));
      t.check(layout, includes(/<body/));
      t.check(layout, includes(/metadata|Metadata/));
      t.check(layout, includes(/children.*ReactNode/));
    });

    await t.group("Home page migrated to Server Component with async data fetching", async () => {
      t.check(await t.sandbox.fileExists("app/page.tsx"), isTrue("app/page.tsx exists"));
      t.check(homePage, includes(/export\s+default\s+async\s+function|async\s+function.*Page/));
      t.check(homePage, excludes(/['"]use client['"];?/));
      t.check(homePage, includes(/await\s+fetch|fetch\(/));
      t.check(homePage, excludes(/getServerSideProps/, { stripComments: true }));
    });

    await t.group("Blog index migrated with ISR equivalent", async () => {
      t.check(await t.sandbox.fileExists("app/blog/page.tsx"), isTrue("app/blog/page.tsx exists"));
      t.check(blogPage, includes(/export\s+default\s+async\s+function|async\s+function/));
      t.check(blogPage, includes(/revalidate.*\d+|next.*revalidate|export.*const.*revalidate.*=.*\d+/));
      t.check(blogPage, excludes(/getStaticProps/, { stripComments: true }));
    });

    await t.group("Dynamic blog route migrated to generateStaticParams", async () => {
      t.check(await t.sandbox.fileExists("app/blog/[id]/page.tsx"), isTrue("dynamic blog route exists"));
      const dynamicBlogPage = t.file("app/blog/[id]/page.tsx");
      t.check(dynamicBlogPage, includes(/export.*generateStaticParams|generateStaticParams.*export/));
      t.check(dynamicBlogPage, includes(/export\s+default\s+async\s+function|async\s+function/));
      t.check(dynamicBlogPage, excludes(/getStaticPaths|getStaticProps/, { stripComments: true }));
    });

    await t.group("API routes migrated to Route Handlers", async () => {
      t.check(await t.sandbox.fileExists("app/api/posts/route.ts"), isTrue("posts route handler exists"));
      const postsRoute = t.file("app/api/posts/route.ts");
      t.check(postsRoute, includes(/export.*GET|export.*POST/));
      t.check(postsRoute, includes(/Request|Response|NextRequest|NextResponse/));

      t.check(await t.sandbox.fileExists("app/api/posts/[id]/route.ts"), isTrue("dynamic posts route handler exists"));
      const dynamicPostsRoute = t.file("app/api/posts/[id]/route.ts");
      t.check(dynamicPostsRoute, includes(/export.*GET|export.*PUT|export.*DELETE/));
    });

    await t.group("Metadata API replaces next/head", () => {
      t.check(homePage, includes(/export.*metadata|metadata.*Metadata/));
      t.check(homePage, excludes(/import.*Head.*next\/head|<Head>/));
      t.check(blogPage, includes(/export.*metadata|metadata.*Metadata/));
      t.check(blogPage, excludes(/import.*Head.*next\/head|<Head>/));
    });

    await t.group("Error handling migrated to error.js and not-found.js", async () => {
      t.check(await t.sandbox.fileExists("app/error.tsx"), isTrue("app/error.tsx exists"));
      const errorPage = t.file("app/error.tsx");
      t.check(errorPage, includes(/['"]use client['"];?/));
      t.check(errorPage, includes(/error.*Error|Error.*error/));
      t.check(await t.sandbox.fileExists("app/not-found.tsx"), isTrue("app/not-found.tsx exists"));
    });

    await t.group("Client components use next/navigation hooks", async () => {
      const homeClientExists = await t.sandbox.fileExists("app/home-client.tsx");
      if (homeClientExists) {
        const homeClient = await t.sandbox.readFile("app/home-client.tsx");
        if (homeClient.includes("useRouter")) {
          t.check(homeClient, includes(/import.*useRouter.*next\/navigation/));
          t.check(homeClient, excludes(/import.*useRouter.*next\/router/));
        }
      }
    });

    await t.group("Pages Router directory removed", () => {
      t.fileDeleted("pages/_app.js");
      t.fileDeleted("pages/_document.js");
      t.fileDeleted("pages/_error.js");
      t.fileDeleted("pages/404.js");
      t.fileDeleted("pages/index.js");
      t.fileDeleted("pages/blog/index.js");
      t.fileDeleted("pages/blog/[id].js");
      t.fileDeleted("pages/api/posts/index.js");
      t.fileDeleted("pages/api/posts/[id].js");
    });

    await t.group("Final source free of legacy Pages APIs and imports", async () => {
      const code = (await t.sandbox.readSourceFiles()).code();
      t.check(code, excludes(/getServerSideProps|getStaticProps|getStaticPaths/));
      // Only flag exact legacy Pages Router imports; App Router imports like next/headers are valid.
      t.check(code, excludes(/\bfrom\s+['"]next\/(?:head|router)['"]|import\s+['"]next\/(?:head|router)['"]/));
    });

    t.check(await t.sandbox.runCommand("npm", ["run", "build"]), commandSucceeded());
  },
});
