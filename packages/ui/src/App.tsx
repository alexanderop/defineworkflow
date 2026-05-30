import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import { reduce, initialRunState } from "@workflow/core";
import type { RunState, WorkflowEvent } from "@workflow/core";
import { Header } from "./Header.js";
import { PhasesColumn } from "./PhasesColumn.js";
import { AgentsColumn } from "./AgentsColumn.js";
import { DetailPane } from "./DetailPane.js";
import { Footer } from "./Footer.js";
import { QuestionPrompt } from "./QuestionPrompt.js";
import { orderedPhases, agentsInPhase, detailSections, runElapsedMs } from "./selectors.js";
import { navReducer, initialNav, type NavState, type NavCtx } from "./navigation.js";
import { resolveKey, type UiAction } from "./keymap.js";

export type { UiAction };

export interface AppProps {
  readonly events: readonly WorkflowEvent[];
  readonly adapter?: string | undefined;
  readonly description?: string | undefined;
  readonly detailRows?: number;
  readonly onAction?: ((action: UiAction) => void) | undefined;
  readonly animate?: boolean;
  /** Fixed clock (ms) for deterministic tests; when omitted the live ticker uses Date.now(). */
  readonly now?: number;
}

const TICK_MS = 250;

function VerticalDivider({ rows }: { readonly rows: number }) {
  return (
    <Box flexDirection="column">
      {Array.from({ length: rows }, (_, i) => (
        <Text key={i} dimColor>
          │
        </Text>
      ))}
    </Box>
  );
}

export function App({ events, adapter, description, detailRows = 12, onAction, animate = true, now: nowProp }: AppProps) {
  const state: RunState = useMemo(() => events.reduce(reduce, initialRunState()), [events]);

  const [nav, setNav] = useState<NavState>(initialNav);
  const [frame, setFrame] = useState(0);
  const [now, setNow] = useState(nowProp ?? Date.now());

  const phases = useMemo(() => orderedPhases(state), [state]);
  const selectedPhase = phases[Math.min(nav.phaseIndex, Math.max(0, phases.length - 1))];
  const agents = useMemo(
    () => (selectedPhase ? agentsInPhase(state, selectedPhase.title) : []),
    [state, selectedPhase],
  );
  const selectedAgent = agents[Math.min(nav.agentIndex, Math.max(0, agents.length - 1))];
  const detailTotal = selectedAgent ? detailSections(selectedAgent, now, nav.expanded).length : 1;

  // Latest values for the input handler, kept in refs to avoid stale closures.
  // DetailPane reserves one row for the scroll indicator when content overflows, so
  // its visible content budget is detailRows-1 in that case. maxScroll must match, or
  // the final line is never scrollable into view.
  const detailVisibleRows = detailTotal > detailRows ? detailRows - 1 : detailRows;
  const ctxRef = useRef<NavCtx>({ phaseCount: 0, agentCount: 0, maxScroll: 0 });
  ctxRef.current = {
    phaseCount: phases.length,
    agentCount: agents.length,
    maxScroll: Math.max(0, detailTotal - detailVisibleRows),
  };
  const navRef = useRef(nav);
  navRef.current = nav;
  const selectedAgentKeyRef = useRef<string | undefined>(undefined);
  selectedAgentKeyRef.current = selectedAgent?.key;

  const running = state.status === "running";
  const paneRows = detailRows + 1;

  // Single ticker drives the spinner frame and the wall-clock `now` while the run is
  // live, so elapsed timers advance even when no events arrive during a long agent call.
  // A fixed `now` prop (tests) disables ticking entirely.
  useEffect(() => {
    if (!animate || nowProp !== undefined || !running) return;
    const id = setInterval(() => {
      setFrame((f) => f + 1);
      setNow(Date.now());
    }, TICK_MS);
    return () => clearInterval(id);
  }, [animate, nowProp, running]);

  const pendingQuestion = state.pendingQuestion;

  useInput((input, key) => {
    // While a question is pending, the QuestionPrompt owns the keyboard — swallow nav/control keys.
    if (pendingQuestion) return;
    const intent = resolveKey(input, key, { focus: navRef.current.focus, agentKey: selectedAgentKeyRef.current });
    if (!intent) return;
    if (intent.kind === "nav") setNav((p) => navReducer(p, intent.action, ctxRef.current));
    else onAction?.(intent.action);
  });

  if (pendingQuestion) {
    return (
      <Box flexDirection="column">
        <Header state={state} elapsedMs={runElapsedMs(state, now)} description={description} adapter={adapter} />
        <QuestionPrompt
          question={pendingQuestion}
          onSubmit={(value) => onAction?.({ type: "answer", key: pendingQuestion.key, value })}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header state={state} elapsedMs={runElapsedMs(state, now)} description={description} adapter={adapter} />
      <Box borderStyle="single" borderColor="gray" minHeight={detailRows + 3}>
        {nav.focus === "detail" ? (
          <>
            <AgentsColumn
              agents={agents}
              selectedIndex={nav.agentIndex}
              focused={false}
              phaseTitle={selectedPhase?.title ?? ""}
              frame={frame}
              now={now}
            />
            <VerticalDivider rows={paneRows} />
            <Box flexDirection="column" flexGrow={1} paddingX={1}>
              <Text bold>{selectedAgent?.label ?? "Agent"}</Text>
              <DetailPane
                agent={selectedAgent}
                scroll={nav.scroll}
                rows={detailRows}
                focused={nav.focus === "detail"}
                now={now}
                expanded={nav.expanded}
              />
            </Box>
          </>
        ) : (
          <>
            <PhasesColumn phases={phases} selectedIndex={nav.phaseIndex} focused={nav.focus === "phases"} frame={frame} />
            <VerticalDivider rows={paneRows} />
            <AgentsColumn
              agents={agents}
              selectedIndex={nav.agentIndex}
              focused={nav.focus === "agents"}
              phaseTitle={selectedPhase?.title ?? ""}
              frame={frame}
              now={now}
            />
          </>
        )}
      </Box>
      <Footer focus={nav.focus} />
    </Box>
  );
}
