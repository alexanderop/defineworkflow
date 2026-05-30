import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { QuestionPrompt } from "./QuestionPrompt.js";

const tick = () => new Promise((r) => setTimeout(r, 10));
const KEY = { down: "[B", up: "[A", enter: "\r" };

describe("QuestionPrompt", () => {
  it("renders the question text and its choices", () => {
    const { lastFrame } = render(
      <QuestionPrompt question={{ key: "k", question: "## Where to deploy?", choices: ["staging", "production"] }} onSubmit={() => {}} />,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("Where to deploy?");
    expect(f).toContain("staging");
    expect(f).toContain("production");
  });

  it("submits the highlighted choice on enter", async () => {
    let answer: string | undefined;
    const { stdin } = render(
      <QuestionPrompt
        question={{ key: "k", question: "?", choices: ["staging", "production"] }}
        onSubmit={(a) => {
          answer = a;
        }}
      />,
    );
    await tick();
    stdin.write(KEY.down); // move to production
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(answer).toBe("production");
  });

  it("submits typed text through the Other option", async () => {
    let answer: string | undefined;
    const { stdin } = render(
      <QuestionPrompt
        question={{ key: "k", question: "?", choices: ["staging"], allowOther: true }}
        onSubmit={(a) => {
          answer = a;
        }}
      />,
    );
    await tick();
    stdin.write(KEY.down); // move to "Other"
    await tick();
    stdin.write(KEY.enter); // enter text mode
    await tick();
    stdin.write("canary");
    await tick();
    stdin.write(KEY.enter); // submit
    await tick();
    expect(answer).toBe("canary");
  });

  it("is a free-text field when there are no choices", async () => {
    let answer: string | undefined;
    const { stdin } = render(
      <QuestionPrompt
        question={{ key: "k", question: "Name?" }}
        onSubmit={(a) => {
          answer = a;
        }}
      />,
    );
    await tick();
    stdin.write("v1.2.0");
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(answer).toBe("v1.2.0");
  });
});
