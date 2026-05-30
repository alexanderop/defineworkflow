export const meta = {
  name: 'update-docs-defineworkflow',
  description: 'Update workflow-monorepo docs to the new defineWorkflow authoring model',
  phases: [
    { title: 'Update', detail: 'one agent per doc file, shared change-brief' },
    { title: 'Audit', detail: 'sweep for residual stale references' },
  ],
}

const BRIEF = `
You are updating documentation in the workflow-monorepo repo (a deterministic multi-agent workflow engine).
The authoring API changed. Update docs to the NEW model. Here are the AUTHORITATIVE facts — trust these over anything in the file:

## THE CHANGE: authoring model
OLD (now outdated, do NOT present as canonical):
- A bare .ts script with \`export const meta = { name, description, harness, phases }\` as the first statement,
  then top-level calls to GLOBAL primitives agent()/parallel()/pipeline()/phase()/log()/workflow(), ending with a
  top-level \`return <result>\`. "No imports." Editor types came from an ambient workflow-globals.d.ts file (now DELETED).

NEW (canonical — document this):
- A .ts file that imports from the "workflow" package and exports a defineWorkflow() default:
\`\`\`ts
import { agent, defineWorkflow, log, parallel, phase } from "workflow";

export default defineWorkflow({
  name: "research-bugs",
  description: "Find bugs across the codebase, then verify each one",
  harness: "claude",
  phases: [{ title: "Find" }, { title: "Verify" }],

  async run() {
    phase("Find");
    const found = await agent("List suspicious files.", { schema: BUGS });

    phase("Verify");
    const checked = await parallel(
      found.bugs.map((b) => () => agent(\\\`Is this real? \\\${b.desc}\\\`, { schema: VERDICT })),
    );

    return checked.filter(Boolean).filter((v) => v.real);
  },
});
\`\`\`
- The imports exist purely for TypeScript/editor support (autocomplete + compile-time checks). The runner STRIPS
  \`import ... from "workflow"\` lines and injects the live runtime values into the sandbox at execution time.
- defineWorkflow makes \`harness\` type-safe: only "claude" | "codex" | "copilot" | "raw-api" are valid; tsc rejects typos.
- The workflow's result is whatever run() returns.
- NOTE: the engine still ACCEPTS the old bare \`export const meta\` + trailing-return style for back-compat, but docs
  should lead with and present defineWorkflow as THE way. Do not spend prose explaining the legacy style; just switch examples.

## OTHER FACTS
- New optional meta field: \`whenToUse?: string\` — a hint shown in the saved/bundled workflow list. Mention where meta fields are listed.
- New public package: \`workflow\` (that is the literal npm-style package name) at packages/workflow. It exports defineWorkflow,
  the runtime primitive stubs (agent/parallel/pipeline/phase/log/workflow), \`z\` (the engine's zod instance), args, budget, and
  types (AgentOptions, HarnessId, WorkflowMeta, ...). It also provides the \`workflow\` CLI bin. This replaces the deleted ambient
  globals .d.ts as the source of editor types.
- \`z\` is now IMPORTED from "workflow" (not a global): \`import { z } from "workflow"\`.
- Harness selection: declared ONLY in meta.harness — there is NO auto-detect and NO --adapter CLI flag / config override for a run.
  (\`workflow adapters\` still DETECTS which CLIs are installed — that's fine and separate.)
- sandbox.ts loading: transformScript() now ALSO handles \`export default defineWorkflow(...)\` (rewriting it so run() is invoked with
  the runtime), AND strips \`import ... from "workflow"\` lines, in addition to the old \`export const meta\` rewrite. extractMeta() still
  reads meta cheaply for the consent gate; for a defineWorkflow file it reads the metadata object passed to defineWorkflow().

## RULES
- Make MINIMAL, PRECISE edits. Preserve each file's voice, structure, Vue/markdown components (<RoughDiagram>, <SandboxWidget>, frontmatter), and tone.
- Only change things that are actually stale per the facts above. Do not rewrite correct content. Do not touch internals docs that describe the journal/semaphore/events/reduce (those are unchanged).
- Keep code samples runnable and consistent with the canonical defineWorkflow shape above.
- Do NOT edit build artifacts under .vitepress/dist or .vitepress/cache.
- After editing, report a concise bullet list of exactly what you changed (and why), or "no changes needed" with reasoning.
`

phase('Update')

const FILES = [
  {
    path: 'apps/docs/guide/index.md',
    note: `Main "What is workflow?" guide page. Update: (1) the intro/mental-model lines that call it a "plain JS/TS script" calling globals — reframe to the import + defineWorkflow model while keeping the deterministic/durable framing. (2) The "## The primitives" table intro line "The runtime injects these as globals into your script's sandbox — there are no imports:" is now wrong — primitives are imported from "workflow" for typing and injected at runtime; reword. (3) The "## A first workflow" code block currently uses the OLD \`export const meta\` + trailing return style — rewrite it to the canonical defineWorkflow form (keep the same research-bugs example logic, add harness: "claude"). (4) The bullet after it about meta.harness being the single source of truth stays true — keep it. Optionally add whenToUse to mental model only if natural.`,
  },
  {
    path: 'apps/docs/guide/sandbox.md',
    note: `The sandbox page. Update the "## How the script is loaded" section: transformScript() now rewrites BOTH \`export const meta = …\` AND \`export default defineWorkflow(...)\` (invoking run() with the runtime), and it also STRIPS \`import ... from "workflow"\` lines (they're editor-only). extractMeta() still reads meta cheaply for the consent gate — for a defineWorkflow file it reads the object passed to defineWorkflow(). Also the <RoughDiagram> caption says primitives are "injected as globals" — that's still mechanically true at runtime (they ARE injected), so you may keep it, but if any prose says authors use globals with "no imports", correct it to: authors import from "workflow" for types; the runtime injects the real values. Keep the banned Date/Math content unchanged.`,
  },
  {
    path: 'apps/docs/.vitepress/theme/code-samples.ts',
    note: `This holds the interactive widget's "workflow" sample (the \`workflow:\` key) which currently uses the OLD \`export const meta\` + trailing-return style. Rewrite ONLY the \`workflow\` sample string to the canonical defineWorkflow shape (import { agent, defineWorkflow, parallel, phase } from "workflow"; export default defineWorkflow({ name, description, harness: "claude", phases, async run() { ... return ... } })). Preserve the research-bugs logic (Find/Verify, BUGS/VERDICT schema, filter). Do NOT change the other samples (seq/queued/journal/etc.) — those are real @workflow/core internals and are unchanged. The file header comment says "Real excerpts from @workflow/core" — keep it.`,
  },
  {
    path: 'CLAUDE.md',
    note: `Repo guide for Claude. Updates: (1) The top paragraph "A workflow is a plain JS/TS script that orchestrates..." — adjust to mention the defineWorkflow authoring surface imported from the \`workflow\` package (keep the durable/sandbox/journaled framing). (2) In the sandbox.ts bullet (~line 77) it says transformScript "rewrites \`export const meta = …\`" — expand to note it also handles \`export default defineWorkflow(...)\` and strips \`import ... from "workflow"\`. (3) Add the new \`workflow\` package to the Architecture section: a public package (npm name \`workflow\`) at packages/workflow that exports defineWorkflow, the primitive stubs, z, and types for editor/typecheck support, and provides the \`workflow\` bin — it's the authoring entrypoint. Update the dependency-direction line if it lists packages (schema → core → adapters → cli, with ui/examples/workflow at the edges). (4) Mention the new optional meta.whenToUse field where meta is described. (5) The examples package note references haiku.workflow.ts — it's still the minimal example, fine, but it now uses defineWorkflow. Keep edits surgical.`,
  },
  {
    path: 'packages/cli/README.md',
    note: `IMPORTANT — verify against reality, do not invent. The "## Bundled example workflows" section claims \`deep-research\` and \`vue-newsletter\` are bundled and resolvable by name, pointing to \`examples/deep-research.ts\` and \`examples/vue-newsletter.ts\`. BUT: the top-level \`examples/\` directory was DELETED; \`examples/deep-research.ts\` no longer exists anywhere; example workflows now live at \`packages/examples/src/*.workflow.ts\` (haiku.workflow.ts, smoke.workflow.ts, vue-newsletter.workflow.ts). So the deep-research example was removed and the paths are stale. Correct this section to reflect that runnable examples now live in packages/examples/src/ as *.workflow.ts (haiku, smoke, vue-newsletter), authored with defineWorkflow. Do NOT claim a workflow is bundled-by-name unless you are sure — if uncertain about the bundled-by-name mechanism, describe the examples by their path instead. Keep the "## Test commands" section as-is (still accurate).`,
  },
  {
    path: 'apps/docs/cli.md',
    note: `Mostly current. Verify the command list and prose. The commands block and consent/resume/config sections look accurate (harness lives in meta.harness, not overridable — keep). The only candidate change: if you mention what \`workflow save\` / \`workflow list\` surface, you MAY note the new optional meta.whenToUse hint appears in the saved-workflow listing — but ONLY if it fits naturally; otherwise make NO changes and report "no changes needed". Do not invent flags.`,
  },
]

const updates = await parallel(
  FILES.map((f) => () =>
    agent(`${BRIEF}\n\n## YOUR FILE: ${f.path}\n${f.note}\n\nRead the file, make the precise edits, then report what you changed.`, {
      label: f.path.replace(/^.*\//, ''),
      phase: 'Update',
    }),
  ),
)

phase('Audit')
const audit = await agent(
  `Audit the workflow-monorepo docs for any RESIDUAL stale references to the OLD authoring model after an update pass.\n` +
  `The new canonical model: workflows import from the "workflow" package and \`export default defineWorkflow({ name, description, harness, phases, async run(){...} })\`. ` +
  `Imports are editor-only and stripped by the sandbox at runtime. z is imported from "workflow". Harness is declared in meta.harness (no auto-detect, no --adapter flag).\n\n` +
  `Search these locations (NOT .vitepress/dist or .vitepress/cache build artifacts): apps/docs/*.md, apps/docs/guide/*.md, apps/docs/.vitepress/theme/code-samples.ts, CLAUDE.md, packages/cli/README.md, packages/examples/README.md.\n` +
  `Look for outdated phrasings still presenting the old model as canonical: "export const meta" used as the primary example, "injected as globals ... no imports", "trailing return value", "auto-detect" of harness, "--adapter" flag, references to deleted files (workflow-globals.d.ts, examples/deep-research.ts), or z described as a global rather than imported.\n` +
  `Use Grep/Read only — do NOT edit. Report a list of file:line findings that are still stale and what each should say, or "clean — no residual stale references" if none. Distinguish genuinely-stale from intentional back-compat mentions.`,
  { label: 'audit', phase: 'Audit' },
)

return { updates: updates.filter(Boolean), audit }
