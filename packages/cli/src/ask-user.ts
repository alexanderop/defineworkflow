import { ok, err, type Result } from "neverthrow";
import { WorkflowThrow, type QuestionRequest } from "@workflow/core";

export type AnswerMap = Readonly<Record<string, string>>;

/** Parse the `--answers` flag: a flat JSON object of question-key → answer string. */
export function parseAnswers(json: string | undefined): Result<AnswerMap, string> {
  if (json === undefined) return ok({});
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return err("--answers is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err("--answers must be a JSON object of string answers");
  }
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v !== "string") return err(`--answers value for "${key}" must be a string`);
    out[key] = v;
  }
  return ok(out);
}

/**
 * An `askUser` handler for runs with no human present (headless / detached / non-TTY / CI).
 * Pre-supplied answers win, then the question's own `default`; otherwise the run fails fast with
 * `UnansweredQuestion` — a non-interactive run must never hang waiting on a prompt nobody can see.
 */
export function createHeadlessAskUser(answers: AnswerMap): (req: QuestionRequest) => Promise<string> {
  return async (req) => {
    const supplied = answers[req.key];
    if (supplied !== undefined) return supplied;
    if (req.default !== undefined) return req.default;
    throw new WorkflowThrow({ kind: "UnansweredQuestion", key: req.key });
  };
}
