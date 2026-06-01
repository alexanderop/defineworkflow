import { z } from "defineworkflow";

// Schemas (zod → inferred types, validated at runtime by the engine).
export const SCOPE_SCHEMA = z.object({
  question: z.string(),
  summary: z.string().describe("1-2 sentence decomposition strategy"),
  angles: z
    .array(
      z.object({
        label: z.string(),
        query: z.string().describe("the web search query for this angle"),
        rationale: z.string().optional(),
      }),
    )
    .min(3)
    .max(6),
});

export const SEARCH_SCHEMA = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        snippet: z.string().optional(),
        relevance: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(6),
});

export const EXTRACT_SCHEMA = z.object({
  sourceQuality: z.enum(["primary", "secondary", "blog", "forum", "unreliable"]),
  publishDate: z.string().optional(),
  claims: z
    .array(
      z.object({
        claim: z.string().describe("a concrete, checkable statement"),
        quote: z.string().describe("a direct quote from the source supporting the claim"),
        importance: z.enum(["central", "supporting", "tangential"]),
      }),
    )
    .max(5),
});

export const VERDICT_SCHEMA = z.object({
  refuted: z.boolean(),
  evidence: z.string().describe("specific evidence for the verdict"),
  confidence: z.enum(["high", "medium", "low"]),
  counterSource: z.string().optional(),
});

export const REPORT_SCHEMA = z.object({
  summary: z.string().describe("3-5 sentence executive summary answering the question"),
  findings: z.array(
    z.object({
      claim: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      sources: z.array(z.string()),
      evidence: z.string(),
      vote: z.string().optional(),
    }),
  ),
  caveats: z.string().describe("what's uncertain, weak sources, time-sensitivity"),
  openQuestions: z.array(z.string()).optional(),
});
