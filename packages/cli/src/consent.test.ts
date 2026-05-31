import { describe, it, expect } from "vitest";
import { decideConsent, promptConsent, type ConsentIO } from "./consent.js";

const meta = {
  name: "demo",
  description: "d",
  harness: "claude" as const,
  phases: [{ title: "A" }, { title: "B" }],
};

describe("decideConsent", () => {
  const base = { config: {}, project: "/proj", name: "demo" };

  it("allows when --yes", () => {
    expect(decideConsent({ ...base, yes: true, isTTY: true, ci: false })).toBe("allow");
  });

  it("allows in non-TTY / CI contexts", () => {
    expect(decideConsent({ ...base, yes: false, isTTY: false, ci: false })).toBe("allow");
    expect(decideConsent({ ...base, yes: false, isTTY: true, ci: true })).toBe("allow");
  });

  it("allows when a recorded consent exists for this project+name", () => {
    expect(
      decideConsent({
        config: { consents: { "/proj": { demo: true } } },
        project: "/proj",
        name: "demo",
        yes: false,
        isTTY: true,
        ci: false,
      }),
    ).toBe("allow");
  });

  it("prompts in an interactive TTY with no recorded consent", () => {
    expect(decideConsent({ ...base, yes: false, isTTY: true, ci: false })).toBe("prompt");
  });
});

function scriptedIO(answers: string[]): { io: ConsentIO; output: () => string } {
  let i = 0;
  let out = "";
  return {
    io: {
      question: async () => answers[i++] ?? "",
      write: (s) => {
        out += s;
      },
    },
    output: () => out,
  };
}

describe("promptConsent", () => {
  it("Yes → allow without remember", async () => {
    const { io } = scriptedIO(["y"]);
    expect(await promptConsent(meta, "src", io)).toEqual({ allow: true, remember: false });
  });

  it("No → deny", async () => {
    const { io } = scriptedIO(["n"]);
    expect(await promptConsent(meta, "src", io)).toEqual({ allow: false, remember: false });
  });

  it("Yes-don't-ask-again → allow with remember", async () => {
    const { io } = scriptedIO(["a"]);
    expect(await promptConsent(meta, "src", io)).toEqual({ allow: true, remember: true });
  });

  it("View prints the script then re-prompts", async () => {
    const { io, output } = scriptedIO(["v", "y"]);
    const result = await promptConsent(meta, "the-script-source", io);
    expect(output()).toContain("the-script-source");
    expect(result.allow).toBe(true);
  });

  it("shows the workflow name and phases before prompting", async () => {
    const { io, output } = scriptedIO(["y"]);
    await promptConsent(meta, "src", io);
    expect(output()).toContain("demo");
    expect(output()).toContain("A");
    expect(output()).toContain("B");
  });

  it("shows the declared harness before prompting", async () => {
    const { io, output } = scriptedIO(["y"]);
    await promptConsent(meta, "src", io);
    expect(output()).toContain("harness: claude");
  });
});
