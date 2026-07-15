import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

export default defineEval({
  description: "tool-call observability smoke: agent shell calls are recorded as action events",
  async test(t) {
    await t.sandbox.uploadDirectory("../../workspaces/tool-call-observability");

    await t
      .send(
        "Use a shell command to create a file named TOOL_CALL_SMOKE.txt in the current repository. " +
          "The file must contain exactly this single line: niceeval-tool-call-ok",
      )
      .then((turn) => turn.expectOk());

    await t.group("Agent shell tool call is observable", () => {
      t.calledTool("shell");
      t.eventsSatisfy(
        "emitted a canonical shell action.called event",
        (events) =>
          events.some((event) => event.type === "action.called" && event.tool === "shell"),
      );
    });

    t.check(
      await t.sandbox.runShell("test -f TOOL_CALL_SMOKE.txt && grep -Fx 'niceeval-tool-call-ok' TOOL_CALL_SMOKE.txt"),
      commandSucceeded(),
    );
  },
});
