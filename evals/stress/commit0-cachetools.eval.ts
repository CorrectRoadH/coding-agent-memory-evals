import { defineEval } from "niceeval";
import { commandSucceeded, excludes } from "niceeval/expect";

export default defineEval({
  description: "Stress / Commit0 cachetools: implement the full library from stubs until 213 upstream tests pass",
  tags: ["stress", "large"],
  timeoutMs: 1800000,
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/commit0-cachetools");
    const baselineCommit = await t.sandbox.runShell('git add -A && git commit -q -m "workspace" --allow-empty');
    if (baselineCommit.exitCode !== 0) throw new Error(`workspace baseline failed: ${baselineCommit.stderr || baselineCommit.stdout}`);
    const baseline = (await t.sandbox.runCommand("git", ["rev-parse", "HEAD"])).stdout.trim();

    for (const [cmd, args] of [
      ["apt-get", ["update"]],
      ["apt-get", ["install", "-y", "python3", "python3-pip"]],
      ["python3", ["-m", "pip", "install", "--break-system-packages", "pytest==8.4.1"]],
    ] as const) {
      const setup = await t.sandbox.runCommand(cmd, [...args], { root: true });
      if (setup.exitCode !== 0) throw new Error(`setup command failed: ${cmd} ${args.join(" ")}\n${setup.stderr || setup.stdout}`);
    }

    await t
      .send(
        "This is an intentionally large stress eval. Implement the complete `cachetools` library in `cachetools/`. " +
          "All APIs are stubbed and SPEC.rst is authoritative. Make `python3 -m pytest tests -rA -q` pass. " +
          "Do not modify tests/ and do not install or vendor cachetools from PyPI.",
      )
      .then((turn) => turn.expectOk());

    await t.group("Implementation lives in the repo", async () => {
      t.check(
        await t.sandbox.runCommand("python3", [
          "-c",
          "import os, sys; sys.path.insert(0, os.getcwd()); import cachetools; " +
            "p = os.path.abspath(cachetools.__file__); assert p.startswith(os.getcwd() + os.sep), p",
        ]),
        commandSucceeded(),
      );
      t.check(t.sandbox.file("cachetools/__init__.py"), excludes(/raise\s+NotImplementedError/));
    });

    t.check(
      await t.sandbox.runCommand("git", ["diff", "--exit-code", baseline, "--", "tests/"]),
      commandSucceeded(),
    );
    t.check(await t.sandbox.runCommand("npm", ["run", "test"]), commandSucceeded());
  },
});
