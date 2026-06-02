import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { dispatch } from "./dispatch.js";
import { fakeDeps } from "./test-support.js";

const target = "packages/examples/src/haiku.workflow.ts";
const source = () => fs.readFileSync(target, "utf8");

describe("workflow graph terminal snapshots e2e", () => {
  it("renders the haiku example as an ASCII screenshot", async () => {
    const { deps, out } = fakeDeps({ _files: { [target]: source() } });

    const code = await dispatch(["graph", target, "--format", "ascii"], deps);

    expect(code).toBe(0);
    expect(out()).toMatchSnapshot("haiku ASCII graph screenshot");
  });

  it("renders the haiku example as a DOT screenshot", async () => {
    const { deps, out } = fakeDeps({ _files: { [target]: source() } });

    const code = await dispatch(["graph", target, "--format", "dot"], deps);

    expect(code).toBe(0);
    expect(out()).toMatchSnapshot("haiku DOT graph screenshot");
  });

  it("renders the haiku example as a JSON screenshot", async () => {
    const { deps, out } = fakeDeps({ _files: { [target]: source() } });

    const code = await dispatch(["graph", target, "--format", "json"], deps);

    expect(code).toBe(0);
    expect(out()).toMatchSnapshot("haiku JSON graph screenshot");
  });

  it("renders a complex workflow as an ASCII screenshot", async () => {
    const complexTarget = "/complex.workflow.ts";
    const complexSource = `export default defineWorkflow({
  name: "complex-review",
  description: "Plan, draft in parallel, ask, and save output",
  harness: "claude",
  phases: ["Plan", "Draft", "Decide"],
  output: "review-output",
  async run() {
    phase("Plan");
    await agent("Make a plan", { label: "planner", schema: z.object({ ok: z.boolean() }) });
    phase("Draft");
    await parallel([
      () => agent("Draft angle A", { label: "angle-a" }),
      () => agent("Draft angle B", { label: "angle-b" }),
    ]);
    phase("Decide");
    await askUserQuestion({ key: "ship", question: "Ship it?" });
    return { ok: true };
  },
});`;
    const { deps, out } = fakeDeps({ _files: { [complexTarget]: complexSource } });

    const code = await dispatch(["graph", complexTarget, "--format", "ascii"], deps);

    expect(code).toBe(0);
    expect(out()).toMatchSnapshot("complex ASCII graph screenshot");
  });

  it("renders the haiku example as an SVG screenshot", async () => {
    const { deps, out } = fakeDeps({
      _files: { [target]: source() },
      adapters: {
        processRunner: {
          run: async (req) => ({
            code: 0,
            stdout: `<svg data-command="${req.command}" data-args="${req.args.join(" ")}"><text>haiku graph</text></svg>\n`,
            stderr: "",
          }),
        },
      },
    });

    const code = await dispatch(["graph", target, "--format", "svg"], deps);

    expect(code).toBe(0);
    expect(out()).toMatchSnapshot("haiku SVG graph screenshot");
  });
});
