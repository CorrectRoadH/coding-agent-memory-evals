import { readFile } from "node:fs/promises";

import { defineEval } from "fasteval";

const fixture = (path: string) => new URL(`../fixtures/repomod/hello-world-api/${path}`, import.meta.url);

export default defineEval({
  description: "RepoMod-Bench hello-world-api: translate Flask API to Java Spring Boot",
  workspace: "./workspaces/repomod-hello-world-api",
  setup: async (sandbox) => {
    // 装系统依赖需要 root(apt / 系统级 pip);{ root: true } 跨后端一致。agent 阶段仍默认非 root。
    await sandbox.runCommand("apt-get", ["update"], { root: true });
    await sandbox.runCommand(
      "apt-get",
      ["install", "-y", "curl", "openjdk-17-jdk", "maven", "python3", "python3-pip"],
      { root: true },
    );
    await sandbox.runCommand(
      "python3",
      ["-m", "pip", "install", "--break-system-packages", "pytest==8.4.1", "requests==2.32.4"],
      { root: true },
    );
  },
  async test(t) {
    await t
      .send(
        "Translate the Flask API in `src/` into a Java Spring Boot implementation in `dst/`.\n\n" +
          "The target must build with `mvn clean package -DskipTests` from `dst/`, run with `SERVER_PORT=3000 java -jar target/*.jar`, and preserve the HTTP API behavior described in README.md. " +
          "Do not wrap or call the Python source implementation; implement the Java service directly.",
      )
      .then((turn) => turn.expectOk());

    const conftest = await readFile(fixture("tests/conftest.py"), "utf8");
    const testApi = await readFile(fixture("tests/test_api.py"), "utf8");

    await t.sandbox.writeFiles({
      "tests/conftest.py": conftest,
      "tests/test_api.py": testApi,
      "tests/run-tests.sh": [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "cd dst",
        "mvn clean package -DskipTests",
        "SERVER_PORT=3000 java -jar target/*.jar > ../server.log 2>&1 &",
        "server_pid=$!",
        "trap 'kill $server_pid 2>/dev/null || true' EXIT",
        "for i in $(seq 1 30); do",
        "  if curl -fsS http://localhost:3000/ >/dev/null 2>&1; then break; fi",
        "  sleep 1",
        "done",
        "cd ..",
        "python3 -m pytest tests/test_api.py --api-port=3000 -rA",
      ].join("\n"),
    });

    await t.sandbox.runCommand("chmod", ["+x", "tests/run-tests.sh"]);
    t.scriptPassed("test");
  },
});
