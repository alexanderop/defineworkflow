import { Box, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { reduce, initialRunState } from "@workflow/core";
import type { RunState, WorkflowEvent } from "@workflow/core";
import { Header } from "./Header.js";
import { PhasesColumn } from "./PhasesColumn.js";
import { AgentsColumn } from "./AgentsColumn.js";
import { DetailPane } from "./DetailPane.js";
import { orderedPhases, agentsInPhase, detailLines, elapsedMs } from "./selectors.js";
import { navReducer, initialNav, type NavState, type NavCtx } from "./navigation.js";

export type UiAction =
  | { readonly type: "pause" }
  | { readonly type: "stop"; readonly target: { readonly scope: "run" } | { readonly scope: "agent"; readonly key: string } }
  | { readonly type: "restart"; readonly key: string }
  | { readonly type: "save" };

export interface AppProps {
  readonly events: readonly WorkflowEvent[];
  readonly adapter?: string | undefined;
  readonly detailRows?: number;
  readonly onAction?: ((action: UiAction) => void) | undefined;
  readonly animate?: boolean;
}

export function App({ events, adapter, detailRows = 12, onAction, animate = true }: AppProps) {
  const state: RunState = useMemo(() => events.reduce(reduce, initialRunState()), [events]);

  const [nav, setNav] = useState<NavState>(initialNav);
  const [frame, setFrame] = useState(0);

  const phases = useMemo(() => orderedPhases(state), [state]);
  const selectedPhase = phases[Math.min(nav.phaseIndex, Math.max(0, phases.length - 1))];
  const agents = useMemo(
    () => (selectedPhase ? agentsInPhase(state, selectedPhase.title) : []),
    [state, selectedPhase],
  );
  const selectedAgent = agents[Math.min(nav.agentIndex, Math.max(0, agents.length - 1))];
  const detailTotal = selectedAgent ? detailLines(selectedAgent).length : 1;

  // Latest values for the input handler, kept in refs to avoid stale closures.
  const ctxRef = useRef<NavCtx>({ phaseCount: 0, agentCount: 0, maxScroll: 0 });
  ctxRef.current = {
    phaseCount: phases.length,
    agentCount: agents.length,
    maxScroll: Math.max(0, detailTotal - detailRows),
  };
  const navRef = useRef(nav);
  navRef.current = nav;
  const selectedAgentKeyRef = useRef<string | undefined>(undefined);
  selectedAgentKeyRef.current = selectedAgent?.key;

  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => setFrame((f) => f + 1), 120);
    return () => clearInterval(id);
  }, [animate]);

  useInput((input, key) => {
    if (key.upArrow) setNav((p) => navReducer(p, { type: "up" }, ctxRef.current));
    else if (key.downArrow) setNav((p) => navReducer(p, { type: "down" }, ctxRef.current));
    else if (key.rightArrow) setNav((p) => navReducer(p, { type: "right" }, ctxRef.current));
    else if (key.leftArrow) setNav((p) => navReducer(p, { type: "left" }, ctxRef.current));
    else if (key.escape) setNav((p) => navReducer(p, { type: "esc" }, ctxRef.current));
    else if (input === "j") setNav((p) => navReducer(p, { type: "scrollDown" }, ctxRef.current));
    else if (input === "k") setNav((p) => navReducer(p, { type: "scrollUp" }, ctxRef.current));
    else if (input === "p") onAction?.({ type: "pause" });
    else if (input === "x") {
      const agentKey = selectedAgentKeyRef.current;
      if (navRef.current.focus !== "phases" && agentKey) onAction?.({ type: "stop", target: { scope: "agent", key: agentKey } });
      else onAction?.({ type: "stop", target: { scope: "run" } });
    } else if (input === "r") {
      const agentKey = selectedAgentKeyRef.current;
      if (agentKey) onAction?.({ type: "restart", key: agentKey });
    } else if (input === "s") onAction?.({ type: "save" });
  });

  return (
    <Box flexDirection="column">
      <Header state={state} elapsedMs={elapsedMs(events)} adapter={adapter} />
      <Box>
        <PhasesColumn phases={phases} selectedIndex={nav.phaseIndex} focused={nav.focus === "phases"} frame={frame} />
        <AgentsColumn
          agents={agents}
          selectedIndex={nav.agentIndex}
          focused={nav.focus === "agents"}
          phaseTitle={selectedPhase?.title ?? ""}
          frame={frame}
        />
        <DetailPane agent={selectedAgent} scroll={nav.scroll} rows={detailRows} focused={nav.focus === "detail"} />
      </Box>
    </Box>
  );
}
