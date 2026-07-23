#!/usr/bin/env python3
"""Drive the built `toggl` binary against a throwaway HTTP stub and report what it did.

Reads a plan (JSON) that describes the fake Toggl API plus a list of CLI invocations,
runs each one, and writes a single JSON document to stdout:

    {"cases": [{"name": ..., "exit": 0, "stdout": "...", "stderr": "...",
                "lines": ["..."], "requests": ["/me", "/me/time_entries?..."]}]}

`lines` is stdout with blank lines dropped and runs of whitespace collapsed, so column
padding is never part of a contract. This script makes no assertions of its own — every
judgement lives in the eval file, one assertion per agreed convention, so a report shows
exactly which convention a run got wrong.
"""

import argparse
import json
import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_USER = {
    "api_token": "probe-token",
    "email": "tester@example.com",
    "fullname": "Tester",
    "timezone": "UTC",
    "default_workspace_id": 1,
}

DEFAULT_PROJECTS = [
    {
        "id": 11,
        "name": "Alpha",
        "workspace_id": 1,
        "client_id": None,
        "is_private": False,
        "active": True,
        "at": "2026-01-01T00:00:00Z",
        "created_at": "2026-01-01T00:00:00Z",
        "server_deleted_at": None,
        "color": "c9806b",
        "billable": False,
    },
    {
        "id": 12,
        "name": "Beta",
        "workspace_id": 1,
        "client_id": None,
        "is_private": False,
        "active": True,
        "at": "2026-01-01T00:00:00Z",
        "created_at": "2026-01-01T00:00:00Z",
        "server_deleted_at": None,
        "color": "465bb3",
        "billable": False,
    },
]


def entries_for(plan, path):
    """Pick the time-entry payload for a request, based on the window it asked for."""
    for window in plan.get("windows", []):
        if window["contains"] in path:
            return window["entries"]
    return plan.get("default_entries", [])


def build_handler(plan, requests):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):  # noqa: N802 - required name
            requests.append(self.path)
            route = self.path.split("?")[0]
            if route == "/me":
                body = plan.get("user", DEFAULT_USER)
            elif route == "/me/projects":
                body = plan.get("projects", DEFAULT_PROJECTS)
            elif route == "/me/time_entries":
                body = entries_for(plan, self.path)
            else:
                body = []
            payload = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return Handler


def normalize(stdout):
    return [" ".join(line.split()) for line in stdout.splitlines() if line.strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--bin", required=True)
    args = parser.parse_args()

    with open(args.plan, encoding="utf-8") as handle:
        plan = json.load(handle)

    requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), build_handler(plan, requests))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]

    env = dict(os.environ)
    env.update(
        {
            "TOGGL_API_TOKEN": "probe-token",
            "TOGGL_API_URL": f"http://127.0.0.1:{port}",
            # Responses are per-case; the on-disk HTTP cache would leak one case into the next.
            "TOGGL_DISABLE_HTTP_CACHE": "1",
            "NO_COLOR": "1",
            "TZ": "UTC",
        }
    )

    results = []
    for case in plan["cases"]:
        requests.clear()
        # Run outside the repo: main() loads a repo-local .env with override semantics,
        # which would clobber the environment set above.
        try:
            completed = subprocess.run(
                [args.bin, *case["args"]],
                capture_output=True,
                text=True,
                env=env,
                cwd=tempfile.gettempdir(),
                timeout=60,
            )
            exit_code, stdout, stderr = completed.returncode, completed.stdout, completed.stderr
        except subprocess.TimeoutExpired:
            exit_code, stdout, stderr = None, "", "probe: command timed out after 60s"

        results.append(
            {
                "name": case["name"],
                "args": case["args"],
                "exit": exit_code,
                "stdout": stdout,
                "stderr": stderr,
                "lines": normalize(stdout),
                "requests": list(requests),
            }
        )

    server.shutdown()
    print(json.dumps({"cases": results}))


if __name__ == "__main__":
    main()
