import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Footer } from "./Footer.js";

describe("Footer", () => {
  it("shows list-level keys when not in the detail pane", () => {
    const { lastFrame } = render(<Footer focus="phases" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("select");
    expect(frame).toContain("stop workflow");
    expect(frame).toContain("save");
    expect(frame).not.toContain("scroll");
  });

  it("shows detail-level keys (scroll + prompt) when focused on detail", () => {
    const { lastFrame } = render(<Footer focus="detail" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("scroll");
    expect(frame).toContain("prompt");
    expect(frame).not.toContain("pause");
  });
});
