import { describe, it, expect } from "vitest";
import { navReducer, initialNav, type NavCtx } from "./navigation.js";

const ctx: NavCtx = { phaseCount: 3, agentCount: 5, maxScroll: 4 };

describe("navReducer", () => {
  it("starts focused on phases at index 0", () => {
    expect(initialNav).toEqual({
      focus: "phases",
      phaseIndex: 0,
      agentIndex: 0,
      scroll: 0,
      expanded: false,
    });
  });

  it("down/up move and clamp the phase selection while focused on phases", () => {
    const a = navReducer(initialNav, { type: "down" }, ctx);
    expect(a.phaseIndex).toBe(1);
    const top = navReducer(initialNav, { type: "up" }, ctx);
    expect(top.phaseIndex).toBe(0); // clamped at 0
    const last = [...Array(10)].reduce((s) => navReducer(s, { type: "down" }, ctx), initialNav);
    expect(last.phaseIndex).toBe(2); // clamped at phaseCount - 1
  });

  it("changing the phase resets agent selection and scroll", () => {
    const moved = navReducer(
      { focus: "phases", phaseIndex: 0, agentIndex: 3, scroll: 2, expanded: true },
      { type: "down" },
      ctx,
    );
    expect(moved).toMatchObject({ phaseIndex: 1, agentIndex: 0, scroll: 0, expanded: false });
  });

  it("right/left move focus across columns; esc jumps back to phases", () => {
    const toAgents = navReducer(initialNav, { type: "right" }, ctx);
    expect(toAgents.focus).toBe("agents");
    const toDetail = navReducer(toAgents, { type: "right" }, ctx);
    expect(toDetail.focus).toBe("detail");
    const stillDetail = navReducer(toDetail, { type: "right" }, ctx);
    expect(stillDetail.focus).toBe("detail"); // no column past detail
    const backToAgents = navReducer(toDetail, { type: "left" }, ctx);
    expect(backToAgents.focus).toBe("agents");
    expect(navReducer(toDetail, { type: "esc" }, ctx).focus).toBe("phases");
  });

  it("down/up move and clamp the agent selection while focused on agents", () => {
    const onAgents = {
      focus: "agents" as const,
      phaseIndex: 0,
      agentIndex: 0,
      scroll: 0,
      expanded: false,
    };
    expect(navReducer(onAgents, { type: "down" }, ctx).agentIndex).toBe(1);
    const last = [...Array(10)].reduce((s) => navReducer(s, { type: "down" }, ctx), onAgents);
    expect(last.agentIndex).toBe(4); // clamped at agentCount - 1
  });

  it("down/up move the agent selection while focused on detail (and reset the detail view)", () => {
    const onDetail = {
      focus: "detail" as const,
      phaseIndex: 0,
      agentIndex: 2,
      scroll: 3,
      expanded: true,
    };
    const down = navReducer(onDetail, { type: "down" }, ctx);
    expect(down).toMatchObject({ agentIndex: 3, scroll: 0, expanded: false }); // selects next agent, resets scroll/expand
    const up = navReducer(onDetail, { type: "up" }, ctx);
    expect(up).toMatchObject({ agentIndex: 1, scroll: 0, expanded: false });
    const last = [...Array(10)].reduce((s) => navReducer(s, { type: "down" }, ctx), onDetail);
    expect(last.agentIndex).toBe(4); // clamped at agentCount - 1
  });

  it("j/k still scroll the detail pane while focused on detail", () => {
    const onDetail = {
      focus: "detail" as const,
      phaseIndex: 0,
      agentIndex: 2,
      scroll: 0,
      expanded: false,
    };
    expect(navReducer(onDetail, { type: "scrollDown" }, ctx).scroll).toBe(1);
    const max = [...Array(10)].reduce((s) => navReducer(s, { type: "scrollDown" }, ctx), onDetail);
    expect(max.scroll).toBe(4); // clamped at maxScroll
    expect(navReducer({ ...onDetail, scroll: 2 }, { type: "scrollUp" }, ctx).scroll).toBe(1);
  });

  it("scrollDown/scrollUp move and clamp the detail scroll within maxScroll", () => {
    const s1 = navReducer(initialNav, { type: "scrollDown" }, ctx);
    expect(s1.scroll).toBe(1);
    const max = [...Array(10)].reduce(
      (s) => navReducer(s, { type: "scrollDown" }, ctx),
      initialNav,
    );
    expect(max.scroll).toBe(4); // clamped at maxScroll
    expect(navReducer(initialNav, { type: "scrollUp" }, ctx).scroll).toBe(0); // clamped at 0
  });

  it("toggleExpand flips the prompt-expand flag and resets scroll", () => {
    const expanded = navReducer({ ...initialNav, scroll: 3 }, { type: "toggleExpand" }, ctx);
    expect(expanded.expanded).toBe(true);
    expect(expanded.scroll).toBe(0);
    expect(navReducer(expanded, { type: "toggleExpand" }, ctx).expanded).toBe(false);
  });
});
