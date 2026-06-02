import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { readFile, readdir } from "node:fs/promises";
import {
  basename as pathBasename,
  dirname as pathDirname,
  join as pathJoin,
  resolve as pathResolve,
} from "node:path";
import { Type } from "typebox";

const CUSTOM_ENTRY = "afk-pipeline-state";
const WIDGET_ID = "afk-pipeline";
const STATUS_ID = "afk-pipeline";

const PHASES = ["spec", "slice", "ralph", "refactor", "qa", "review", "done"] as const;
const STATUSES = ["pending", "active", "done", "blocked"] as const;
const ARTIFACT_KINDS = ["spec", "ticket", "branch", "qa-report", "pr", "note", "other"] as const;

type Phase = (typeof PHASES)[number];
type Status = (typeof STATUSES)[number];
type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

interface SliceState {
  id: string;
  title: string;
  status: Status;
  ticketPath?: string;
  branch?: string;
  tmuxSession?: string;
  worktreePath?: string;
  summary?: string;
  updatedAt: number;
}

interface ArtifactState {
  path: string;
  kind: ArtifactKind;
  note?: string;
  createdAt: number;
}

interface PipelineState {
  name: string;
  specPath: string;
  phase: Phase;
  phaseStatus: Status;
  note?: string;
  slices: SliceState[];
  artifacts: ArtifactState[];
  createdAt: number;
  updatedAt: number;
}

const PhaseParam = StringEnum(PHASES);
const StatusParam = StringEnum(STATUSES);
const ArtifactKindParam = StringEnum(ARTIFACT_KINDS);

const SetPhaseParams = Type.Object({
  phase: PhaseParam,
  status: Type.Optional(StatusParam),
  note: Type.Optional(
    Type.String({ description: "Short human-readable note about the current pipeline step" }),
  ),
});

const UpdateSliceParams = Type.Object({
  id: Type.String({ description: "Stable slice id, e.g. 01-guest-info" }),
  title: Type.Optional(Type.String({ description: "Short slice title" })),
  status: Type.Optional(StatusParam),
  ticketPath: Type.Optional(Type.String({ description: "Path to the slice ticket file" })),
  branch: Type.Optional(Type.String({ description: "Git branch for this slice" })),
  tmuxSession: Type.Optional(
    Type.String({ description: "tmux session name for this slice worker" }),
  ),
  worktreePath: Type.Optional(
    Type.String({ description: "Git worktree path for this slice worker" }),
  ),
  summary: Type.Optional(Type.String({ description: "Short progress/blocker summary" })),
});

const ArtifactParams = Type.Object({
  path: Type.String({ description: "Artifact path or URL" }),
  kind: ArtifactKindParam,
  note: Type.Optional(Type.String({ description: "Why this artifact matters" })),
});

const BlockedParams = Type.Object({
  reason: Type.String({ description: "What is blocked and what human input is needed" }),
  sliceId: Type.Optional(
    Type.String({ description: "Optional slice id if the blocker is slice-specific" }),
  ),
});

function now(): number {
  return Date.now();
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function safeId(value: string): string {
  return (
    value
      .replace(/\.(md|markdown|txt)$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "slice"
  );
}

function titleFromSpec(path: string): string {
  return (
    basename(path)
      .replace(/\.(md|markdown|txt)$/i, "")
      .replace(/^prd[-_]?/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "afk pipeline"
  );
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "spec":
      return "Spec aligned";
    case "slice":
      return "Slice tickets";
    case "ralph":
      return "Ralph loops";
    case "refactor":
      return "Refactor pass";
    case "qa":
      return "Agentic QA";
    case "review":
      return "Human review";
    case "done":
      return "Done";
    default:
      return phase;
  }
}

function statusIcon(status: Status): string {
  switch (status) {
    case "done":
      return "✓";
    case "active":
      return "⏳";
    case "blocked":
      return "!";
    case "pending":
      return "○";
    default:
      return "○";
  }
}

function phaseStatus(state: PipelineState, phase: Phase): Status {
  if (phase === state.phase) return state.phaseStatus;
  const currentIndex = PHASES.indexOf(state.phase);
  const phaseIndex = PHASES.indexOf(phase);
  if (state.phase === "done" || phaseIndex < currentIndex) return "done";
  return "pending";
}

function colorStatus(theme: Theme, status: Status, text: string): string {
  switch (status) {
    case "done":
      return theme.fg("success", text);
    case "active":
      return theme.fg("accent", text);
    case "blocked":
      return theme.fg("warning", text);
    case "pending":
      return theme.fg("dim", text);
    default:
      return theme.fg("dim", text);
  }
}

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && PHASES.some((phase) => phase === value);
}

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && STATUSES.some((status) => status === value);
}

function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && ARTIFACT_KINDS.some((kind) => kind === value);
}

function isSliceState(value: unknown): value is SliceState {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "title" in value &&
    "status" in value &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isStatus(value.status)
  );
}

function isArtifactState(value: unknown): value is ArtifactState {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    "kind" in value &&
    typeof value.path === "string" &&
    isArtifactKind(value.kind)
  );
}

function isPipelineState(value: unknown): value is PipelineState {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "specPath" in value &&
    "phase" in value &&
    "phaseStatus" in value &&
    "slices" in value &&
    "artifacts" in value &&
    typeof value.name === "string" &&
    typeof value.specPath === "string" &&
    isPhase(value.phase) &&
    isStatus(value.phaseStatus) &&
    Array.isArray(value.slices) &&
    value.slices.every(isSliceState) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifactState)
  );
}

function isAfkEntry(
  entry: unknown,
): entry is { type: "custom"; customType: string; data?: unknown } {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "type" in entry &&
    "customType" in entry &&
    entry.type === "custom" &&
    entry.customType === CUSTOM_ENTRY
  );
}

function cloneState(state: PipelineState): PipelineState {
  return {
    ...state,
    slices: state.slices.map((slice) => ({ ...slice })),
    artifacts: state.artifacts.map((artifact) => ({ ...artifact })),
  };
}

function summarize(state: PipelineState): string {
  const done = state.slices.filter((slice) => slice.status === "done").length;
  const blocked = state.slices.filter((slice) => slice.status === "blocked").length;
  const sliceText = state.slices.length > 0 ? ` • slices ${done}/${state.slices.length}` : "";
  const blockedText = blocked > 0 ? ` • blocked ${blocked}` : "";
  return `${state.name}: ${phaseLabel(state.phase)} (${state.phaseStatus})${sliceText}${blockedText}`;
}

function renderWidgetLines(state: PipelineState, theme: Theme, width: number): string[] {
  const lines: string[] = [];
  lines.push(truncateToWidth(theme.fg("accent", theme.bold(`AFK Pipeline: ${state.name}`)), width));
  lines.push(truncateToWidth(`${theme.fg("dim", "spec:")} ${state.specPath}`, width));

  for (const phase of PHASES) {
    if (phase === "done") continue;
    const status = phaseStatus(state, phase);
    const prefix = colorStatus(theme, status, statusIcon(status));
    const current = phase === state.phase ? theme.fg("accent", " ← current") : "";
    lines.push(truncateToWidth(`  ${prefix} ${phaseLabel(phase)}${current}`, width));
  }

  if (state.slices.length > 0) {
    const completed = state.slices.filter((slice) => slice.status === "done").length;
    lines.push(
      truncateToWidth(theme.fg("muted", `  slices: ${completed}/${state.slices.length}`), width),
    );
    for (const slice of state.slices.slice(0, 5)) {
      const icon = colorStatus(theme, slice.status, statusIcon(slice.status));
      const location = slice.branch ? theme.fg("dim", ` (${slice.branch})`) : "";
      lines.push(truncateToWidth(`    ${icon} ${slice.id} ${slice.title}${location}`, width));
    }
    if (state.slices.length > 5) {
      lines.push(
        truncateToWidth(
          theme.fg("dim", `    … ${state.slices.length - 5} more; /afk board`),
          width,
        ),
      );
    }
  }

  if (state.note) lines.push(truncateToWidth(`${theme.fg("muted", "note:")} ${state.note}`, width));
  lines.push(truncateToWidth(theme.fg("dim", "/afk board • /afk status • /afk reset"), width));
  return lines;
}

class PipelineBoard {
  private state: PipelineState;
  private theme: Theme;
  private onClose: () => void;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(state: PipelineState, theme: Theme, onClose: () => void) {
    this.state = state;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const theme = this.theme;
    const lines: string[] = [];
    const rule = theme.fg("borderMuted", "─".repeat(Math.max(0, width)));
    lines.push(rule);
    lines.push(
      truncateToWidth(theme.fg("accent", theme.bold(` AFK Pipeline — ${this.state.name}`)), width),
    );
    lines.push(truncateToWidth(`${theme.fg("muted", "Spec")} ${this.state.specPath}`, width));
    lines.push("");

    for (const phase of PHASES) {
      if (phase === "done") continue;
      const status = phaseStatus(this.state, phase);
      const marker = colorStatus(theme, status, statusIcon(status));
      const label = phaseLabel(phase);
      const current = phase === this.state.phase ? theme.fg("accent", " current") : "";
      lines.push(truncateToWidth(`${marker} ${label}${current}`, width));
    }

    if (this.state.slices.length > 0) {
      lines.push("");
      lines.push(truncateToWidth(theme.fg("muted", theme.bold("Slices")), width));
      for (const slice of this.state.slices) {
        const marker = colorStatus(theme, slice.status, statusIcon(slice.status));
        const meta = [
          slice.ticketPath,
          slice.branch,
          slice.tmuxSession ? `tmux:${slice.tmuxSession}` : undefined,
          slice.worktreePath,
        ]
          .filter((item): item is string => Boolean(item))
          .join(" • ");
        lines.push(
          truncateToWidth(`${marker} ${theme.fg("accent", slice.id)} ${slice.title}`, width),
        );
        if (meta) lines.push(truncateToWidth(`    ${theme.fg("dim", meta)}`, width));
        if (slice.summary) lines.push(truncateToWidth(`    ${slice.summary}`, width));
      }
    }

    if (this.state.artifacts.length > 0) {
      lines.push("");
      lines.push(truncateToWidth(theme.fg("muted", theme.bold("Artifacts")), width));
      for (const artifact of this.state.artifacts.slice(-10)) {
        const note = artifact.note ? theme.fg("dim", ` — ${artifact.note}`) : "";
        lines.push(
          truncateToWidth(`• ${theme.fg("accent", artifact.kind)} ${artifact.path}${note}`, width),
        );
      }
    }

    if (this.state.note) {
      lines.push("");
      lines.push(truncateToWidth(`${theme.fg("muted", "Note")} ${this.state.note}`, width));
    }

    lines.push("");
    lines.push(truncateToWidth(theme.fg("dim", "q / Esc close"), width));
    lines.push(rule);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export default function afkPipeline(pi: ExtensionAPI): void {
  let state: PipelineState | undefined;
  let widgetVisible = true;

  function persist(): void {
    if (!state) return;
    pi.appendEntry(CUSTOM_ENTRY, cloneState(state));
  }

  function restore(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getEntries();
    state = undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!isAfkEntry(entry)) continue;
      state = isPipelineState(entry.data) ? cloneState(entry.data) : undefined;
      break;
    }
  }

  function updateUi(ctx: ExtensionContext): void {
    if (!state) {
      ctx.ui.setStatus(STATUS_ID, undefined);
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }

    const status =
      state.phaseStatus === "blocked" ? "blocked" : `${state.phase}:${state.phaseStatus}`;
    ctx.ui.setStatus(STATUS_ID, colorStatus(ctx.ui.theme, state.phaseStatus, `AFK ${status}`));

    if (!widgetVisible) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }

    const snapshot = cloneState(state);
    ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => ({
      render(width: number): string[] {
        return renderWidgetLines(snapshot, theme, width);
      },
      invalidate(): void {},
    }));
  }

  function setState(next: PipelineState, ctx: ExtensionContext): void {
    state = next;
    persist();
    updateUi(ctx);
  }

  function requireState(): PipelineState {
    if (!state) throw new Error("No AFK pipeline active. Run /afk start <spec-path> first.");
    return state;
  }

  function buildContext(): string {
    if (!state) return "";
    const slices = state.slices.length
      ? state.slices
          .map(
            (slice) =>
              `- ${slice.id}: ${slice.status} — ${slice.title}${slice.ticketPath ? ` (${slice.ticketPath})` : ""}${slice.tmuxSession ? ` [tmux:${slice.tmuxSession}]` : ""}`,
          )
          .join("\n")
      : "- none yet";
    const artifacts = state.artifacts.length
      ? state.artifacts
          .map(
            (artifact) =>
              `- ${artifact.kind}: ${artifact.path}${artifact.note ? ` — ${artifact.note}` : ""}`,
          )
          .join("\n")
      : "- none yet";

    return `[AFK PIPELINE ACTIVE]
Name: ${state.name}
Spec: ${state.specPath}
Current phase: ${state.phase} (${state.phaseStatus})
Note: ${state.note ?? "none"}

Slices:
${slices}

Artifacts:
${artifacts}

AFK pipeline rules:
- Keep the human-facing pipeline state accurate.
- When entering a phase, call afk_set_phase.
- When creating, starting, finishing, or blocking a slice, call afk_update_slice.
- When writing specs, tickets, QA reports, branches, or PR URLs, call afk_record_artifact.
- If you need human judgment, call afk_mark_blocked and ask a clear question.
- Follow this phase order: spec → slice → ralph → refactor → qa → review → done.
- Prefer vertical slices. During Ralph implementation use red-green-refactor, run checks, commit, then tick completed checkboxes.
- Never delete failing tests to make the suite pass.`;
  }

  async function discoverTicketPaths(ctx: ExtensionContext): Promise<string[]> {
    const current = requireState();
    const fromState = current.slices
      .map((slice) => slice.ticketPath)
      .filter((path): path is string => Boolean(path));
    if (fromState.length > 0) return [...new Set(fromState)].toSorted();

    const ticketsDir = pathResolve(ctx.cwd, "docs/tickets");
    try {
      const entries = await readdir(ticketsDir);
      return entries
        .filter((entry) => entry.endsWith(".md"))
        .toSorted()
        .map((entry) => `docs/tickets/${entry}`);
    } catch {
      return [];
    }
  }

  async function repoRoot(ctx: ExtensionContext): Promise<string> {
    const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 5000 });
    const root = result.stdout.trim();
    return result.code === 0 && root ? root : ctx.cwd;
  }

  async function syncWorkers(ctx: ExtensionContext): Promise<void> {
    if (!state) return;

    let changed = false;
    const slices: SliceState[] = [];

    for (const slice of state.slices) {
      let next = slice;
      if (slice.tmuxSession) {
        const tmux = await pi.exec("tmux", ["has-session", "-t", slice.tmuxSession], {
          timeout: 2000,
        });
        if (tmux.code === 0) {
          next = {
            ...slice,
            status: slice.status === "done" ? "done" : "active",
            summary: `Ralph worker running in tmux:${slice.tmuxSession}`,
            updatedAt: now(),
          };
        } else if (slice.worktreePath) {
          try {
            const prompt = await readFile(pathJoin(slice.worktreePath, "PROMPT.md"), "utf8");
            const hasUnchecked = /^- \[ \]/m.test(prompt);
            next = {
              ...slice,
              status: hasUnchecked ? "blocked" : "done",
              summary: hasUnchecked
                ? "Ralph worker stopped with unchecked tasks"
                : "Ralph worker completed all tasks",
              updatedAt: now(),
            };
          } catch {
            next = {
              ...slice,
              summary: "Could not inspect Ralph worker worktree",
              updatedAt: now(),
            };
          }
        }
      }
      changed = changed || next !== slice;
      slices.push(next);
    }

    if (changed) {
      setState({ ...state, slices, updatedAt: now() }, ctx);
    }
  }

  async function runRalphWorkers(ctx: ExtensionContext): Promise<void> {
    const current = requireState();
    const tickets = await discoverTicketPaths(ctx);
    if (tickets.length === 0) {
      ctx.ui.notify("No tickets found. Create docs/tickets/*.md or add slices first.", "warning");
      return;
    }

    const root = await repoRoot(ctx);
    const projectName = pathBasename(root);
    let nextState = cloneState(current);
    let launched = 0;

    for (const ticketPath of tickets) {
      const id = safeId(pathBasename(ticketPath));
      const branch = `afk/${id}`;
      const tmuxSession = `pi-afk-${id}`;
      const worktreePath = pathJoin(pathDirname(root), `${projectName}-afk-${id}`);
      const ticketAbsolute = pathResolve(root, ticketPath);
      const existing = nextState.slices.find((slice) => slice.id === id);
      if (existing?.status === "done") continue;

      const hasSession = await pi.exec("tmux", ["has-session", "-t", tmuxSession], {
        timeout: 2000,
      });
      if (hasSession.code === 0) {
        nextState = {
          ...nextState,
          slices: nextState.slices.map((slice) =>
            slice.id === id
              ? { ...slice, status: "active", tmuxSession, worktreePath, branch, updatedAt: now() }
              : slice,
          ),
        };
        continue;
      }

      const workerPrompt = `Use the afk-coding skill. You are a Ralph worker for one vertical slice.

Read PROMPT.md. Do exactly one unchecked task using red-green-refactor:
1. write or update the failing test first,
2. implement the smallest passing change,
3. refactor without changing behavior,
4. run relevant checks,
5. commit,
6. tick the completed checkbox in PROMPT.md,
7. exit.

Never delete or weaken failing tests to pass. If blocked, write a clear blocker note in PROMPT.md and exit non-zero.`;

      const script = `set -euo pipefail
ROOT=${shellQuote(root)}
WT=${shellQuote(worktreePath)}
TICKET=${shellQuote(ticketAbsolute)}
BRANCH=${shellQuote(branch)}
SESSION_NAME=${shellQuote(`afk-${id}`)}
WORKER_PROMPT=${shellQuote(workerPrompt)}

if [ ! -e "$WT/.git" ]; then
  git -C "$ROOT" worktree add "$WT" -b "$BRANCH" || git -C "$ROOT" worktree add "$WT" "$BRANCH"
fi
cp "$TICKET" "$WT/PROMPT.md"
cd "$WT"
while grep -q '^- \\[ \\]' PROMPT.md; do
  pi --name "$SESSION_NAME" -p @PROMPT.md "$WORKER_PROMPT"
done
`;

      const tmux = await pi.exec("tmux", ["new-session", "-d", "-s", tmuxSession, script], {
        timeout: 5000,
      });
      if (tmux.code !== 0) {
        ctx.ui.notify(`Failed to launch ${tmuxSession}: ${tmux.stderr || tmux.stdout}`, "error");
        continue;
      }

      const slice: SliceState = {
        id,
        title: existing?.title ?? titleFromSpec(ticketPath),
        status: "active",
        ticketPath,
        branch,
        tmuxSession,
        worktreePath,
        summary: `Ralph worker launched in tmux:${tmuxSession}`,
        updatedAt: now(),
      };

      nextState = {
        ...nextState,
        phase: "ralph",
        phaseStatus: "active",
        note: "Ralph workers are running as separate Pi processes in tmux worktrees.",
        slices: existing
          ? nextState.slices.map((item) => (item.id === id ? slice : item))
          : [...nextState.slices, slice],
        updatedAt: now(),
      };
      launched++;
    }

    setState(nextState, ctx);
    ctx.ui.notify(
      `Ralph workers launched: ${launched}. Use tmux attach -t pi-afk-<slice>.`,
      "info",
    );
  }

  pi.registerCommand("afk", {
    description:
      "Manage the AFK coding pipeline UI: /afk start <spec>, /afk run, /afk board, /afk status, /afk hide, /afk show, /afk reset",
    handler: async (args, ctx) => {
      const [action = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);

      switch (action) {
        case "start": {
          const specPath = normalizePath(rest[0] ?? "");
          if (!specPath) {
            ctx.ui.notify("Usage: /afk start <spec-path>", "warning");
            return;
          }
          const created = now();
          const name = titleFromSpec(specPath);
          setState(
            {
              name,
              specPath,
              phase: "spec",
              phaseStatus: "active",
              note: "Align on the spec, then slice into vertical tickets.",
              slices: [],
              artifacts: [{ path: specPath, kind: "spec", createdAt: created }],
              createdAt: created,
              updatedAt: created,
            },
            ctx,
          );
          pi.setSessionName(`AFK: ${name}`);
          ctx.ui.notify(`AFK pipeline started for ${specPath}`, "info");
          pi.sendUserMessage(`Start the AFK coding pipeline for ${specPath}.

First, read the spec and confirm whether it is clear enough. If it is clear, mark the spec phase done and slice it into vertical tickets under docs/tickets/. Keep the AFK pipeline UI updated with the afk_* tools.`);
          return;
        }

        case "run":
          await runRalphWorkers(ctx);
          return;

        case "sync":
          await syncWorkers(ctx);
          ctx.ui.notify(state ? summarize(state) : "No AFK pipeline active", "info");
          return;

        case "board": {
          if (!state) {
            ctx.ui.notify("No AFK pipeline active. Run /afk start <spec-path>.", "warning");
            return;
          }
          await syncWorkers(ctx);
          const snapshot = cloneState(state);
          await ctx.ui.custom<void>(
            (_tui, theme, _keybindings, done) => new PipelineBoard(snapshot, theme, done),
            {
              overlay: true,
              overlayOptions: { width: "80%", maxHeight: "85%", minWidth: 60, anchor: "center" },
            },
          );
          return;
        }

        case "status": {
          if (!state) {
            ctx.ui.notify("No AFK pipeline active. Run /afk start <spec-path>.", "info");
            return;
          }
          await syncWorkers(ctx);
          updateUi(ctx);
          ctx.ui.notify(summarize(state), "info");
          return;
        }

        case "hide":
          widgetVisible = false;
          updateUi(ctx);
          return;

        case "show":
          widgetVisible = true;
          updateUi(ctx);
          return;

        case "reset":
          state = undefined;
          pi.appendEntry(CUSTOM_ENTRY, undefined);
          updateUi(ctx);
          ctx.ui.notify("AFK pipeline cleared", "info");
          return;

        default:
          ctx.ui.notify(
            "Usage: /afk start <spec> | run | sync | board | status | hide | show | reset",
            "warning",
          );
      }
    },
  });

  pi.registerTool({
    name: "afk_set_phase",
    label: "AFK Phase",
    description: "Update the active AFK coding pipeline phase and status.",
    promptSnippet: "Update the visible AFK pipeline phase/status",
    promptGuidelines: [
      "Use afk_set_phase whenever the AFK pipeline moves to spec, slice, ralph, refactor, qa, review, or done.",
    ],
    parameters: SetPhaseParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = requireState();
      const next: PipelineState = {
        ...current,
        phase: params.phase,
        phaseStatus: params.status ?? "active",
        note: params.note,
        updatedAt: now(),
      };
      setState(next, ctx);
      return {
        content: [{ type: "text", text: `AFK phase set to ${next.phase} (${next.phaseStatus})` }],
        details: cloneState(next),
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("afk phase"))} ${theme.fg("accent", args.phase)} ${theme.fg("dim", args.status ?? "active")}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      return new Text(
        isPipelineState(result.details)
          ? colorStatus(theme, result.details.phaseStatus, summarize(result.details))
          : "AFK phase updated",
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "afk_update_slice",
    label: "AFK Slice",
    description: "Create or update a vertical slice in the AFK pipeline board.",
    promptSnippet: "Create or update a vertical slice on the AFK board",
    promptGuidelines: [
      "Use afk_update_slice whenever a vertical slice is created, started, completed, or blocked.",
    ],
    parameters: UpdateSliceParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = requireState();
      const existing = current.slices.find((slice) => slice.id === params.id);
      const updatedAt = now();
      const nextSlice: SliceState = {
        id: params.id,
        title: params.title ?? existing?.title ?? params.id,
        status: params.status ?? existing?.status ?? "pending",
        ticketPath: params.ticketPath ?? existing?.ticketPath,
        branch: params.branch ?? existing?.branch,
        tmuxSession: params.tmuxSession ?? existing?.tmuxSession,
        worktreePath: params.worktreePath ?? existing?.worktreePath,
        summary: params.summary ?? existing?.summary,
        updatedAt,
      };
      const slices = existing
        ? current.slices.map((slice) => (slice.id === params.id ? nextSlice : slice))
        : [...current.slices, nextSlice];
      const next: PipelineState = { ...current, slices, updatedAt };
      setState(next, ctx);
      return {
        content: [{ type: "text", text: `AFK slice ${params.id} is ${nextSlice.status}` }],
        details: { state: cloneState(next), slice: nextSlice },
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("afk slice"))} ${theme.fg("accent", args.id)} ${theme.fg("dim", args.status ?? "update")}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const details = result.details;
      if (
        typeof details !== "object" ||
        details === null ||
        !("slice" in details) ||
        !isSliceState(details.slice)
      ) {
        return new Text("AFK slice updated", 0, 0);
      }
      const slice = details.slice;
      return new Text(
        `${colorStatus(theme, slice.status, statusIcon(slice.status))} ${theme.fg("accent", slice.id)} ${slice.title}`,
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "afk_record_artifact",
    label: "AFK Artifact",
    description: "Record an AFK pipeline artifact such as a ticket, branch, QA report, or PR URL.",
    promptSnippet: "Record AFK pipeline artifacts for the UI",
    promptGuidelines: [
      "Use afk_record_artifact when creating ticket files, branches, QA reports, PRs, or other AFK pipeline artifacts.",
    ],
    parameters: ArtifactParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = requireState();
      const artifact: ArtifactState = {
        path: params.path,
        kind: params.kind,
        note: params.note,
        createdAt: now(),
      };
      const next: PipelineState = {
        ...current,
        artifacts: [
          ...current.artifacts.filter(
            (item) => !(item.path === artifact.path && item.kind === artifact.kind),
          ),
          artifact,
        ],
        updatedAt: artifact.createdAt,
      };
      setState(next, ctx);
      return {
        content: [{ type: "text", text: `Recorded ${artifact.kind}: ${artifact.path}` }],
        details: { state: cloneState(next), artifact },
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("afk artifact"))} ${theme.fg("accent", args.kind)} ${theme.fg("dim", args.path)}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const details = result.details;
      if (
        typeof details !== "object" ||
        details === null ||
        !("artifact" in details) ||
        !isArtifactState(details.artifact)
      ) {
        return new Text("AFK artifact recorded", 0, 0);
      }
      return new Text(
        `${theme.fg("success", "✓")} ${details.artifact.kind}: ${details.artifact.path}`,
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "afk_mark_blocked",
    label: "AFK Blocked",
    description:
      "Mark the AFK pipeline or a slice as blocked and explain what human input is needed.",
    promptSnippet: "Mark AFK pipeline/slice blocked when human judgment is needed",
    promptGuidelines: [
      "Use afk_mark_blocked before asking the user for human judgment that blocks AFK progress.",
    ],
    parameters: BlockedParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = requireState();
      const updatedAt = now();
      const blockedStatus: Status = "blocked";
      const slices = params.sliceId
        ? current.slices.map((slice) =>
            slice.id === params.sliceId
              ? { ...slice, status: blockedStatus, summary: params.reason, updatedAt }
              : slice,
          )
        : current.slices;
      const next: PipelineState = {
        ...current,
        phaseStatus: "blocked",
        note: params.reason,
        slices,
        updatedAt,
      };
      setState(next, ctx);
      return {
        content: [{ type: "text", text: `AFK pipeline blocked: ${params.reason}` }],
        details: cloneState(next),
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("warning", theme.bold("afk blocked"))} ${theme.fg("dim", args.sliceId ?? "pipeline")}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const note = isPipelineState(result.details) ? result.details.note : undefined;
      return new Text(
        theme.fg("warning", note ? `Blocked: ${note}` : "AFK pipeline blocked"),
        0,
        0,
      );
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (!state) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${buildContext()}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    restore(ctx);
    updateUi(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restore(ctx);
    updateUi(ctx);
  });
}
