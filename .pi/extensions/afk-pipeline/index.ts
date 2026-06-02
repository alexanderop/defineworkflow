import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { copyFile, readFile, readdir, stat } from "node:fs/promises";
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
const DEFAULT_MAX_WORKERS = 1;
const STALE_WORKER_MINUTES = 60;

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
  promptPath?: string;
  logPath?: string;
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

interface RunOptions {
  maxWorkers: number;
  only: string[];
  yes: boolean;
  worktree: boolean;
}

interface WorkerPromptInfo {
  totalTasks: number;
  doneTasks: number;
  uncheckedTasks: number;
  blocker?: string;
  modifiedAt?: number;
}

interface WorkerCommitInfo {
  hash?: string;
  committedAt?: number;
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
  promptPath: Type.Optional(Type.String({ description: "Path to this worker's prompt file" })),
  logPath: Type.Optional(Type.String({ description: "Path to this worker's log file" })),
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRunOptions(tokens: string[]): RunOptions {
  const options: RunOptions = {
    maxWorkers: DEFAULT_MAX_WORKERS,
    only: [],
    yes: false,
    worktree: false,
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (token === "--yes" || token === "-y") {
      options.yes = true;
    } else if (token === "--worktree") {
      options.worktree = true;
    } else if (token === "--in-place" || token === "--no-worktree") {
      options.worktree = false;
    } else if (token === "--max" || token === "-m") {
      options.maxWorkers = parsePositiveInteger(tokens[i + 1], options.maxWorkers);
      i++;
    } else if (token.startsWith("--max=")) {
      options.maxWorkers = parsePositiveInteger(token.slice("--max=".length), options.maxWorkers);
    } else if (token === "--only" || token === "-o") {
      const value = tokens[i + 1];
      if (value)
        options.only.push(
          ...value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        );
      i++;
    } else if (token.startsWith("--only=")) {
      options.only.push(
        ...token
          .slice("--only=".length)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    }
  }
  return {
    ...options,
    maxWorkers: options.worktree ? options.maxWorkers : 1,
    only: [...new Set(options.only)],
  };
}

function ticketId(path: string): string {
  return safeId(pathBasename(path));
}

function matchesRunFilter(path: string, only: string[]): boolean {
  if (only.length === 0) return true;
  const id = ticketId(path);
  return only.some((item) => item === id || safeId(item) === id || path.includes(item));
}

function formatAge(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

function summarizePrompt(content: string, modifiedAt?: number): WorkerPromptInfo {
  const doneTasks = (content.match(/^- \[[xX]\] /gm) ?? []).length;
  const uncheckedTasks = (content.match(/^- \[ \] /gm) ?? []).length;
  const blockerMatch = content.match(/## Blocked\s*\n+([\s\S]*?)(?:\n##\s|$)/i);
  const blocker = blockerMatch?.[1]?.trim().replace(/\s+/g, " ");
  const info: WorkerPromptInfo = {
    totalTasks: doneTasks + uncheckedTasks,
    doneTasks,
    uncheckedTasks,
  };
  if (blocker) info.blocker = blocker;
  if (modifiedAt !== undefined) info.modifiedAt = modifiedAt;
  return info;
}

function workerSummary(
  running: boolean,
  prompt?: WorkerPromptInfo,
  commit?: WorkerCommitInfo,
): string {
  const parts = [running ? "Ralph worker running" : "Ralph worker stopped"];
  if (prompt && prompt.totalTasks > 0) {
    parts.push(`tasks ${prompt.doneTasks}/${prompt.totalTasks}`);
  }
  if (commit?.hash) parts.push(`commit ${commit.hash}`);
  if (running) {
    const activityAt = Math.max(prompt?.modifiedAt ?? 0, commit?.committedAt ?? 0);
    const staleMs = activityAt > 0 ? now() - activityAt : 0;
    if (staleMs > STALE_WORKER_MINUTES * 60_000) {
      parts.push(`possibly stale: no activity for ${formatAge(staleMs)}`);
    }
  }
  if (prompt?.blocker) parts.push(`blocked: ${prompt.blocker}`);
  return parts.join(" • ");
}

function upsertArtifact(artifacts: ArtifactState[], artifact: ArtifactState): ArtifactState[] {
  return [
    ...artifacts.filter((item) => !(item.path === artifact.path && item.kind === artifact.kind)),
    artifact,
  ];
}

function workerBranches(current: PipelineState): string[] {
  return current.slices
    .map((slice) => slice.branch)
    .filter((branch): branch is string => Boolean(branch));
}

async function syncPromptBackToTicket(root: string, slice: SliceState): Promise<void> {
  const promptPath = workerPromptPath(slice);
  if (!slice.ticketPath || !promptPath) return;
  try {
    await copyFile(promptPath, pathResolve(root, slice.ticketPath));
  } catch {
    // Best effort. The board summary still reports the worker state.
  }
}

function workerDirectory(root: string, slice: SliceState): string {
  return slice.worktreePath ?? root;
}

function workerPromptPath(slice: SliceState): string | undefined {
  return (
    slice.promptPath ?? (slice.worktreePath ? pathJoin(slice.worktreePath, "PROMPT.md") : undefined)
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
  lines.push(
    truncateToWidth(theme.fg("dim", "/afk board • /afk logs • /afk run --only <id>"), width),
  );
  return lines;
}

class TextOverlay {
  private title: string;
  private lines: string[];
  private theme: Theme;
  private onClose: () => void;

  constructor(title: string, lines: string[], theme: Theme, onClose: () => void) {
    this.title = title;
    this.lines = lines;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
      this.onClose();
    }
  }

  render(width: number): string[] {
    const rule = this.theme.fg("borderMuted", "─".repeat(Math.max(0, width)));
    return [
      rule,
      truncateToWidth(this.theme.fg("accent", this.theme.bold(` ${this.title}`)), width),
      "",
      ...this.lines.map((line) => truncateToWidth(line, width)),
      "",
      truncateToWidth(this.theme.fg("dim", "q / Esc close"), width),
      rule,
    ];
  }

  invalidate(): void {}
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
          slice.promptPath ? `prompt:${slice.promptPath}` : undefined,
          slice.logPath ? `log:${slice.logPath}` : undefined,
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
              `- ${slice.id}: ${slice.status} — ${slice.title}${slice.ticketPath ? ` (${slice.ticketPath})` : ""}${slice.tmuxSession ? ` [tmux:${slice.tmuxSession}]` : ""}${slice.logPath ? ` [log:${slice.logPath}]` : ""}`,
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

  async function commandExists(command: string): Promise<boolean> {
    const result = await pi.exec(
      "bash",
      ["-lc", `command -v ${shellQuote(command)} >/dev/null 2>&1`],
      {
        timeout: 3000,
      },
    );
    return result.code === 0;
  }

  async function readWorkerPromptInfo(promptPath: string): Promise<WorkerPromptInfo | undefined> {
    try {
      const [content, info] = await Promise.all([readFile(promptPath, "utf8"), stat(promptPath)]);
      return summarizePrompt(content, info.mtimeMs);
    } catch {
      return undefined;
    }
  }

  async function readCommitInfo(worktreePath: string): Promise<WorkerCommitInfo> {
    const hash = await pi.exec("git", ["-C", worktreePath, "rev-parse", "--short", "HEAD"], {
      timeout: 3000,
    });
    const committedAt = await pi.exec("git", ["-C", worktreePath, "log", "-1", "--format=%ct"], {
      timeout: 3000,
    });
    const seconds = Number.parseInt(committedAt.stdout.trim(), 10);
    const result: WorkerCommitInfo = {};
    if (hash.code === 0 && hash.stdout.trim()) result.hash = hash.stdout.trim();
    if (Number.isFinite(seconds)) result.committedAt = seconds * 1000;
    return result;
  }

  async function showOverlay(ctx: ExtensionContext, title: string, lines: string[]): Promise<void> {
    await ctx.ui.custom<void>(
      (_tui, theme, _keybindings, done) => new TextOverlay(title, lines, theme, done),
      {
        overlay: true,
        overlayOptions: { width: "80%", maxHeight: "85%", minWidth: 60, anchor: "center" },
      },
    );
  }

  async function showWorkerFeedback(ctx: ExtensionContext, requestedId?: string): Promise<void> {
    requireState();
    await syncWorkers(ctx);
    const latest = requireState();
    const id = requestedId ? safeId(requestedId) : undefined;
    const slice = id
      ? latest.slices.find((item) => item.id === id || item.ticketPath?.includes(requestedId ?? ""))
      : (latest.slices.find((item) => item.status === "active") ?? latest.slices[0]);

    if (!slice) {
      ctx.ui.notify("No AFK slices found.", "warning");
      return;
    }

    let body = "";
    if (slice.logPath) {
      try {
        const log = await readFile(slice.logPath, "utf8");
        body = log.split("\n").slice(-80).join("\n");
      } catch {
        body = "";
      }
    }

    if (!body && slice.tmuxSession) {
      const capture = await pi.exec(
        "tmux",
        ["capture-pane", "-p", "-t", slice.tmuxSession, "-S", "-200"],
        {
          timeout: 2000,
        },
      );
      if (capture.code === 0) body = capture.stdout;
    }

    const header = [
      `${slice.id} — ${slice.title}`,
      slice.summary ? `summary: ${slice.summary}` : undefined,
      slice.tmuxSession ? `tmux: ${slice.tmuxSession}` : undefined,
      workerPromptPath(slice) ? `prompt: ${workerPromptPath(slice)}` : undefined,
      slice.logPath ? `log: ${slice.logPath}` : undefined,
    ].filter((line): line is string => Boolean(line));

    const lines = [...header, "", ...(body ? body.split("\n") : ["No log output yet."])];
    await showOverlay(ctx, `AFK Feedback — ${slice.id}`, lines);
  }

  async function runDoctor(ctx: ExtensionContext): Promise<void> {
    const root = await repoRoot(ctx);
    const checks: Array<{ ok: boolean; label: string; detail?: string }> = [];

    for (const command of ["pi", "git", "tmux"] as const) {
      checks.push({ ok: await commandExists(command), label: `${command} is available` });
    }

    const worktree = await pi.exec("git", ["-C", root, "worktree", "list"], { timeout: 5000 });
    checks.push({ ok: worktree.code === 0, label: "git worktree is available" });

    const status = await pi.exec("git", ["-C", root, "status", "--porcelain"], { timeout: 5000 });
    checks.push({
      ok: status.code === 0,
      label: "repository status can be inspected",
      detail: status.stdout.trim()
        ? "working tree has uncommitted changes; review before integrating"
        : "working tree clean",
    });

    if (state) {
      try {
        await readFile(pathResolve(root, state.specPath), "utf8");
        checks.push({ ok: true, label: `spec exists: ${state.specPath}` });
      } catch {
        checks.push({ ok: false, label: `spec missing: ${state.specPath}` });
      }
    }

    const tickets = state ? await discoverTicketPaths(ctx) : [];
    checks.push({
      ok: !state || tickets.length > 0,
      label: state ? "slice tickets discovered" : "AFK pipeline state",
      detail: state ? `${tickets.length} ticket(s)` : "no active pipeline; run /afk start <spec>",
    });

    const lines = checks.map((check) => {
      const marker = check.ok ? "✓" : "!";
      const detail = check.detail ? ` — ${check.detail}` : "";
      return `${marker} ${check.label}${detail}`;
    });
    await showOverlay(ctx, "AFK Doctor", lines);
    ctx.ui.notify(
      checks.every((check) => check.ok) ? "AFK doctor passed" : "AFK doctor found issues",
      checks.every((check) => check.ok) ? "info" : "warning",
    );
  }

  async function syncWorkers(ctx: ExtensionContext): Promise<void> {
    if (!state) return;

    let changed = false;
    const slices: SliceState[] = [];
    const root = await repoRoot(ctx);

    for (const slice of state.slices) {
      let next = slice;
      if (slice.tmuxSession) {
        const tmux = await pi.exec("tmux", ["has-session", "-t", slice.tmuxSession], {
          timeout: 2000,
        });
        const running = tmux.code === 0;
        const promptPath = workerPromptPath(slice);
        const prompt = promptPath ? await readWorkerPromptInfo(promptPath) : undefined;
        const commit = await readCommitInfo(workerDirectory(root, slice));

        if (running) {
          next = {
            ...slice,
            status: slice.status === "done" ? "done" : "active",
            summary: `${workerSummary(true, prompt, commit)} in tmux:${slice.tmuxSession}`,
            updatedAt: now(),
          };
        } else if (promptPath && prompt) {
          const done = prompt.uncheckedTasks === 0 && !prompt.blocker;
          next = {
            ...slice,
            status: done ? "done" : "blocked",
            summary: done
              ? `${workerSummary(false, prompt, commit)} • completed`
              : workerSummary(false, prompt, commit),
            updatedAt: now(),
          };
          await syncPromptBackToTicket(root, slice);
        } else if (promptPath) {
          next = {
            ...slice,
            status: "blocked",
            summary: "Could not inspect Ralph worker prompt/log state",
            updatedAt: now(),
          };
        }
      }
      changed = changed || JSON.stringify(next) !== JSON.stringify(slice);
      slices.push(next);
    }

    if (changed) {
      setState({ ...state, slices, updatedAt: now() }, ctx);
    }
  }

  async function startQaPass(ctx: ExtensionContext): Promise<void> {
    const current = requireState();
    const qaPath = `docs/qa/afk-${safeId(current.name)}.md`;
    setState(
      {
        ...current,
        phase: "qa",
        phaseStatus: "active",
        note: `Run an end-to-end QA pass and write ${qaPath}.`,
        artifacts: upsertArtifact(current.artifacts, {
          path: qaPath,
          kind: "qa-report",
          note: "Expected QA report path",
          createdAt: now(),
        }),
        updatedAt: now(),
      },
      ctx,
    );
    pi.sendUserMessage(`Start the AFK QA phase.

Refresh worker state, exercise the real user journey from ${current.specPath}, run the relevant full checks, and write a markdown QA report at ${qaPath} with scenario, steps, expected result, actual result, pass/fail, and logs. Record the report with afk_record_artifact.`);
  }

  async function startReviewPass(ctx: ExtensionContext): Promise<void> {
    await syncWorkers(ctx);
    const latest = requireState();
    const branches = workerBranches(latest);
    setState(
      {
        ...latest,
        phase: "review",
        phaseStatus: "active",
        note: "Prepare human review of worker branches, blockers, and QA findings.",
        updatedAt: now(),
      },
      ctx,
    );
    pi.sendUserMessage(`Start the AFK review phase.

Summarize what changed, list blockers, list worker branches (${branches.join(", ") || "none"}), and call out exactly what a human should inspect before merge.`);
  }

  async function prepareIntegration(ctx: ExtensionContext): Promise<void> {
    const current = requireState();
    await syncWorkers(ctx);
    const latest = requireState();
    const blocked = latest.slices.filter((slice) => slice.status === "blocked");
    if (blocked.length > 0) {
      ctx.ui.notify(
        `Cannot integrate: ${blocked.length} blocked slice(s). Open /afk board.`,
        "warning",
      );
      return;
    }
    const branches = workerBranches(latest);
    if (branches.length === 0) {
      ctx.ui.notify("No worker branches recorded to integrate.", "warning");
      return;
    }
    const root = await repoRoot(ctx);
    const integrationBranch = `afk/integrate-${safeId(current.name)}`;
    setState(
      {
        ...latest,
        phase: "review",
        phaseStatus: "active",
        note: `Integration candidate: ${integrationBranch}`,
        artifacts: upsertArtifact(latest.artifacts, {
          path: integrationBranch,
          kind: "branch",
          note: "Suggested integration branch",
          createdAt: now(),
        }),
        updatedAt: now(),
      },
      ctx,
    );
    pi.sendUserMessage(`Prepare AFK integration.

Repo root: ${root}
Suggested integration branch: ${integrationBranch}
Worker branches:
${branches.map((branch) => `- ${branch}`).join("\n")}

Check out a safe integration branch, merge/rebase worker branches one at a time, resolve conflicts, run full checks, and stop if any behavior or product decision is ambiguous.`);
  }

  async function preparePullRequest(ctx: ExtensionContext): Promise<void> {
    const current = requireState();
    setState(
      {
        ...current,
        phase: "review",
        phaseStatus: "active",
        note: "Draft PR summary and review checklist.",
        updatedAt: now(),
      },
      ctx,
    );
    pi.sendUserMessage(
      "Draft the AFK pull request summary. Include linked spec/tickets, worker branches, test results, QA report, known risks, and a human review checklist. If gh is available and the branch is ready, ask before creating the PR.",
    );
  }

  async function runRalphWorkers(ctx: ExtensionContext, options: RunOptions): Promise<void> {
    requireState();
    await syncWorkers(ctx);
    const current = requireState();
    const activeInPlace = current.slices.find(
      (slice) => slice.status === "active" && Boolean(slice.tmuxSession) && !slice.worktreePath,
    );
    if (!options.worktree && activeInPlace) {
      ctx.ui.notify(
        `An in-place worker is already active (${activeInPlace.id}). Use /afk logs ${activeInPlace.id} or stop it before launching another.`,
        "warning",
      );
      return;
    }
    const discovered = await discoverTicketPaths(ctx);
    const filtered = discovered.filter((path) => matchesRunFilter(path, options.only));
    const eligible = filtered.filter((path) => {
      const existing = current.slices.find((slice) => slice.id === ticketId(path));
      return existing?.status !== "done";
    });
    const tickets = eligible.slice(0, options.maxWorkers);
    if (discovered.length === 0) {
      ctx.ui.notify("No tickets found. Create docs/tickets/*.md or add slices first.", "warning");
      return;
    }
    if (filtered.length === 0) {
      ctx.ui.notify(`No tickets matched: ${options.only.join(", ")}`, "warning");
      return;
    }
    if (tickets.length === 0) {
      ctx.ui.notify("All matched tickets are already done.", "info");
      return;
    }

    if (!options.yes) {
      const preview = tickets.map((ticket) => `- ${ticketId(ticket)} (${ticket})`).join("\n");
      const mode = options.worktree ? "git worktrees" : "the current checkout (in-place, max 1)";
      const ok = await ctx.ui.confirm(
        "Launch AFK workers?",
        `Launch ${tickets.length} worker(s) in ${mode}.\n${preview}`,
      );
      if (!ok) {
        ctx.ui.notify("AFK worker launch cancelled", "info");
        return;
      }
    }

    const root = await repoRoot(ctx);
    const projectName = pathBasename(root);
    let nextState = cloneState(current);
    let launched = 0;

    for (const ticketPath of tickets) {
      const id = ticketId(ticketPath);
      const branch = options.worktree ? `afk/${id}` : undefined;
      const tmuxSession = `pi-afk-${id}`;
      const worktreePath = options.worktree
        ? pathJoin(pathDirname(root), `${projectName}-afk-${id}`)
        : undefined;
      const workerRoot = worktreePath ?? root;
      const promptPath = options.worktree
        ? pathJoin(workerRoot, "PROMPT.md")
        : pathJoin(root, ".pi", "afk", "prompts", `${id}.md`);
      const logPath = pathJoin(root, ".pi", "afk", "logs", `${id}.log`);
      const ticketAbsolute = pathResolve(root, ticketPath);
      const existing = nextState.slices.find((slice) => slice.id === id);
      if (existing?.status === "done") continue;

      const hasSession = await pi.exec("tmux", ["has-session", "-t", tmuxSession], {
        timeout: 2000,
      });
      if (hasSession.code === 0) {
        const activeSlice: SliceState = {
          id,
          title: existing?.title ?? titleFromSpec(ticketPath),
          status: "active",
          ticketPath,
          ...(branch ? { branch } : {}),
          tmuxSession,
          ...(worktreePath ? { worktreePath } : {}),
          promptPath,
          logPath,
          summary: `Existing Ralph worker running in tmux:${tmuxSession}`,
          updatedAt: now(),
        };
        nextState = {
          ...nextState,
          slices: existing
            ? nextState.slices.map((slice) => (slice.id === id ? activeSlice : slice))
            : [...nextState.slices, activeSlice],
        };
        continue;
      }

      const workerPrompt = `Use the afk-coding skill. You are a Ralph worker for one vertical slice.

Read and update this prompt file: ${promptPath}
Do exactly one unchecked task using red-green-refactor:
1. write or update the failing test first,
2. implement the smallest passing change,
3. refactor without changing behavior,
4. run relevant checks,
5. commit,
6. tick the completed checkbox in ${promptPath},
7. exit.

Never delete or weaken failing tests to pass. If blocked, write this exact section in ${promptPath} and exit non-zero:

## Blocked

Reason:
Needed human decision:
Files touched:
Suggested next step:`;

      const script = `set -euo pipefail
ROOT=${shellQuote(root)}
WORKER_ROOT=${shellQuote(workerRoot)}
TICKET=${shellQuote(ticketAbsolute)}
BRANCH=${shellQuote(branch ?? "")}
PROMPT_FILE=${shellQuote(promptPath)}
LOG_FILE=${shellQuote(logPath)}
USE_WORKTREE=${options.worktree ? "1" : "0"}
SESSION_NAME=${shellQuote(`afk-${id}`)}
WORKER_PROMPT=${shellQuote(workerPrompt)}

mkdir -p "$(dirname "$PROMPT_FILE")" "$(dirname "$LOG_FILE")"
{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting AFK worker ${id}"
  if [ "$USE_WORKTREE" = "1" ] && [ ! -e "$WORKER_ROOT/.git" ]; then
    git -C "$ROOT" worktree add "$WORKER_ROOT" -b "$BRANCH" || git -C "$ROOT" worktree add "$WORKER_ROOT" "$BRANCH"
  fi
  cp "$TICKET" "$PROMPT_FILE"
  cd "$WORKER_ROOT"
  while grep -q '^- \\[ \\]' "$PROMPT_FILE"; do
    pi --name "$SESSION_NAME" -p @"$PROMPT_FILE" "$WORKER_PROMPT"
  done
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] AFK worker ${id} finished"
} 2>&1 | tee -a "$LOG_FILE"
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
        ...(branch ? { branch } : {}),
        tmuxSession,
        ...(worktreePath ? { worktreePath } : {}),
        promptPath,
        logPath,
        summary: `Ralph worker launched in tmux:${tmuxSession}. Feedback: /afk logs ${id}`,
        updatedAt: now(),
      };

      const logArtifact: ArtifactState = {
        path: logPath,
        kind: "note",
        note: `Worker log for ${id}`,
        createdAt: now(),
      };
      nextState = {
        ...nextState,
        phase: "ralph",
        phaseStatus: "active",
        note: options.worktree
          ? "Ralph workers are running as separate Pi processes in tmux worktrees."
          : "Ralph worker is running in-place in the current checkout. Use /afk logs for feedback.",
        slices: existing
          ? nextState.slices.map((item) => (item.id === id ? slice : item))
          : [...nextState.slices, slice],
        artifacts: branch
          ? upsertArtifact(upsertArtifact(nextState.artifacts, logArtifact), {
              path: branch,
              kind: "branch",
              note: `Worker branch for ${id}`,
              createdAt: now(),
            })
          : upsertArtifact(nextState.artifacts, logArtifact),
        updatedAt: now(),
      };
      launched++;
    }

    setState(nextState, ctx);
    ctx.ui.notify(
      `Ralph workers launched: ${launched}. Use /afk logs <slice> or tmux attach -t pi-afk-<slice>.`,
      "info",
    );
  }

  pi.registerCommand("afk", {
    description:
      "Manage the AFK coding pipeline UI: /afk start <spec>, /afk doctor, /afk run [--worktree] [--max N] [--only id] [--yes], /afk logs [id], /afk qa, /afk review, /afk integrate, /afk pr, /afk board",
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

        case "doctor":
          await runDoctor(ctx);
          return;

        case "run":
          await runRalphWorkers(ctx, parseRunOptions(rest));
          return;

        case "logs":
        case "log":
        case "feedback":
          await showWorkerFeedback(ctx, rest[0]);
          return;

        case "qa":
          await startQaPass(ctx);
          return;

        case "review":
          await startReviewPass(ctx);
          return;

        case "integrate":
          await prepareIntegration(ctx);
          return;

        case "pr":
          await preparePullRequest(ctx);
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
            "Usage: /afk start <spec> | doctor | run [--worktree] [--max N] [--only id] [--yes] | logs [id] | qa | review | integrate | pr | sync | board | status | hide | show | reset",
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
        promptPath: params.promptPath ?? existing?.promptPath,
        logPath: params.logPath ?? existing?.logPath,
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
