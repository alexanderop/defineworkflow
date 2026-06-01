import { z } from "zod";
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { Immutable } from "@workflow/core";
import type { AppDeps } from "./app.js";

/**
 * `agents` is a verifiable count, but a fan-out workflow's agent count is dynamic — represented
 * as the literal `"N"` (displayed verbatim) rather than a misleading fixed number.
 */
const Agents = z.union([z.number().int().nonnegative(), z.literal("N")]);

const TemplateEntry = z.object({
  name: z.string(),
  description: z.string(),
  harness: z.enum(["claude", "codex", "copilot", "raw-api"]),
  tags: z.array(z.string()).default([]),
  complexity: z.enum(["beginner", "intermediate", "advanced", "reference"]).optional(),
  whenToUse: z.string().optional(),
  agents: Agents.optional(),
  recommended: z.boolean().default(false),
  multiFile: z.boolean(),
  entry: z.string(),
  dir: z.string().optional(),
});
export type TemplateEntry = z.infer<typeof TemplateEntry>;

/** The bundled gallery manifest. `version` lets the format evolve; an unknown one fails fast. */
export const TemplateIndex = z.object({
  version: z.literal(1),
  templates: z.array(TemplateEntry),
});
export type TemplateIndex = z.infer<typeof TemplateIndex>;

/**
 * Read + validate the bundled `templates/index.json`. A missing/malformed/unknown-version manifest
 * is surfaced as an error **value** (never a throw), consistent with the other CLI-surface commands.
 */
export function loadTemplateIndex(
  deps: Pick<AppDeps, "env" | "io">,
): Result<Immutable<TemplateIndex>, string> {
  const raw = deps.io.readText(`${deps.env.templatesDir}/index.json`);
  if (raw === undefined) return err("templates index not found — reinstall defineworkflow");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err("malformed templates/index.json: invalid JSON");
  }
  const parsed = TemplateIndex.safeParse(json);
  if (!parsed.success) return err(`malformed templates/index.json: ${parsed.error.message}`);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- ingress data exposed deeply-readonly per the Immutable convention
  return ok(parsed.data as Immutable<TemplateIndex>);
}
