// A deep-research harness as one workflow: decompose a question into search
// angles, fan out web searches, fetch + extract falsifiable claims, then put
// every claim through 3-vote adversarial verification before synthesizing a
// cited report. Ported from a bughunter-style architecture — WebSearch/WebFetch
// instead of git/grep.
//
// The shape is: Scope → pipeline(Search → URL-dedup → Fetch+Extract) → Verify → Synthesize.
// The middle uses pipeline() so each search angle flows search → dedup → fetch
// INDEPENDENTLY (no barrier); the Verify step is an intentional barrier because the
// full claim pool must be assembled before ranking and voting.
//
// Run it (real agents on the Claude Code harness, uses tokens + web search):
//   workflow run packages/examples/src/deep-research.workflow.ts \
//     --args '"How durable are LLM-based coding agents in production?"' --yes
//   workflow run packages/examples/src/deep-research.workflow.ts \
//     --args '{"question":"Is RISC-V ready for laptops in 2026?"}' --yes
//
// Iterate on the control flow with NO agents/tokens spent:
//   workflow run packages/examples/src/deep-research.workflow.ts --mock
//
// NOTE: the engine requires `defineWorkflow(...)` to be the FIRST runtime statement
// in the file. Only type-only declarations (the `interface`s below, erased at
// compile time) may precede it — so the zod schemas are declared inside run().

import { agent, args, defineWorkflow, log, parallel, phase, pipeline, z } from "defineworkflow";

// Type-only shapes (erased by the compiler) used to type the accumulator state and the
// FetchedSource literals. The pipeline now infers each stage's prev/item from the zod
// schemas, so these are no longer needed to cast `unknown` stage results.
interface SearchHit {
  url: string;
  title: string;
  snippet?: string | undefined;
  relevance: "high" | "medium" | "low";
}
interface AngleResults {
  angle: string;
  results: SearchHit[];
}
interface Claim {
  claim: string;
  quote: string;
  importance: "central" | "supporting" | "tangential";
  sourceUrl: string;
  sourceQuality: string;
}
interface FetchedSource {
  url: string;
  title: string;
  angle: string;
  sourceQuality: "primary" | "secondary" | "blog" | "forum" | "unreliable";
  publishDate: string;
  claims: Claim[];
}

export default defineWorkflow({
  name: "deep-research",
  description:
    "Deep research harness — fan out web searches, fetch sources, adversarially verify claims, synthesize a cited report.",
  whenToUse:
    'When the user wants a deep, multi-source, fact-checked research report on any topic. Pass the question as args, either a bare string ("…") or {"question":"…"}. If the question is underspecified, narrow it (budget/use-case/region) before invoking.',
  harness: "claude",
  // Persist the finished report. `result.json` holds the full return value verbatim;
  // the top-level `summary` string field is also extracted to `summary.md`.
  output: "./research",
  phases: [
    { title: "Scope", detail: "decompose the question into 5 search angles" },
    { title: "Search", detail: "one parallel WebSearch agent per angle" },
    { title: "Fetch", detail: "URL-dedup, fetch top sources, extract falsifiable claims" },
    { title: "Verify", detail: "3-vote adversarial verification per claim (2/3 refutes kills it)" },
    { title: "Synthesize", detail: "merge dupes, rank by confidence, cite sources" },
  ],

  async run() {
    const VOTES_PER_CLAIM = 3;
    const REFUTATIONS_REQUIRED = 2;
    const MAX_FETCH = 15;
    const MAX_VERIFY_CLAIMS = 25;

    // ── Schemas (zod → inferred types, validated at runtime by the engine) ────────
    const SCOPE_SCHEMA = z.object({
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
    const SEARCH_SCHEMA = z.object({
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
    const EXTRACT_SCHEMA = z.object({
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
    const VERDICT_SCHEMA = z.object({
      refuted: z.boolean(),
      evidence: z.string().describe("specific evidence for the verdict"),
      confidence: z.enum(["high", "medium", "low"]),
      counterSource: z.string().optional(),
    });
    const REPORT_SCHEMA = z.object({
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

    // `args` is the research question, passed as a bare JSON string or {question}.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the deeply-immutable CLI args payload
    const rawArgs = (args ?? "") as string | { question?: string };
    const QUESTION = (typeof rawArgs === "string" ? rawArgs : (rawArgs.question ?? "")).trim();
    if (!QUESTION) {
      return {
        error:
          'No research question provided. Pass it as args, e.g. --args \'"your question"\' or --args \'{"question":"…"}\'.',
      };
    }

    // ── Phase 0: Scope — decompose the question into search angles ────────────────
    phase("Scope");
    log(`Q: ${QUESTION.slice(0, 80)}${QUESTION.length > 80 ? "…" : ""}`);
    const scope = await agent(
      `Decompose this research question into complementary search angles.\n\n` +
        `## Question\n${QUESTION}\n\n` +
        `## Task\n` +
        `Generate 5 distinct web search queries that together cover the question from different angles. ` +
        `Pick angles that suit the question's domain. Examples:\n` +
        `- broad/primary · academic/technical · recent news · contrarian/skeptical · practitioner/implementation\n` +
        `- For medical: anatomy · common causes · serious differentials · authoritative refs · red flags\n` +
        `- For tech: state-of-art · benchmarks · limitations · industry adoption · cost/tradeoffs\n\n` +
        `Make queries specific enough to surface high-signal results. Avoid redundancy.\n` +
        `Return: the question (verbatim or lightly normalized), a 1-2 sentence decomposition strategy, and the angles.`,
      { label: "scope", phase: "Scope", schema: SCOPE_SCHEMA },
    );
    if (!scope) {
      return { error: "Scope agent returned no result — cannot decompose the research question." };
    }
    log(`Decomposed into ${scope.angles.length} angles: ${scope.angles.map((a) => a.label).join(", ")}`);

    // ── Dedup state — accumulates across searchers as they complete ───────────────
    // The sandbox injects `URL`, so parse with `new URL()` (falls back to the raw string on a
    // malformed URL rather than throwing).
    const hostOf = (u: string): string | undefined => {
      try {
        return new URL(u).hostname.replace(/^www\./, "");
      } catch {
        return undefined;
      }
    };
    const normURL = (u: string): string => {
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.replace(/^www\./, "");
        const path = parsed.pathname.replace(/\/$/, "");
        return (host + path).toLowerCase();
      } catch {
        return u.toLowerCase();
      }
    };
    const relRank: Record<"high" | "medium" | "low", number> = { high: 0, medium: 1, low: 2 };
    const seen = new Map<string, { angle: string; title: string }>();
    const dupes: Array<SearchHit & { angle: string }> = [];
    const budgetDropped: Array<SearchHit & { angle: string }> = [];
    let fetchSlots = MAX_FETCH;

    // ── Prompts ───────────────────────────────────────────────────────────────────
    const SEARCH_PROMPT = (angle: { label: string; query: string; rationale?: string | undefined }): string =>
      `## Web Searcher: ${angle.label}\n\n` +
      `Research question: "${QUESTION}"\n\n` +
      `Your angle: **${angle.label}** — ${angle.rationale ?? ""}\n` +
      `Search query: \`${angle.query}\`\n\n` +
      `## Task\nUse WebSearch with the query above (or a refined version). Return the top 4-6 most relevant results.\n` +
      `Rank by relevance to the ORIGINAL question, not just the search query. Skip obvious SEO spam/content farms.\n` +
      `Include a short snippet capturing why each result is relevant.`;

    const FETCH_PROMPT = (source: SearchHit, angle: string): string =>
      `## Source Extractor\n\n` +
      `Research question: "${QUESTION}"\n\n` +
      `Fetch and extract key claims from this source:\n` +
      `**URL:** ${source.url}\n**Title:** ${source.title}\n**Found via:** ${angle} search\n\n` +
      `## Task\n1. Use WebFetch to retrieve the page content.\n` +
      `2. Assess source quality: primary research/institution? secondary reporting? blog/opinion? forum? unreliable?\n` +
      `3. Extract 2-5 FALSIFIABLE claims that bear on the research question. Each claim must:\n` +
      `   - be a concrete, checkable statement (not vague generalities)\n` +
      `   - include a direct quote from the source as support\n` +
      `   - be rated central/supporting/tangential to the research question\n` +
      `4. Note publish date if available.\n\n` +
      `If the fetch fails or the page is irrelevant/paywalled, return claims: [] and sourceQuality: "unreliable".`;

    const VERIFY_PROMPT = (claim: Claim, v: number): string =>
      `## Adversarial Claim Verifier (voter ${v + 1}/${VOTES_PER_CLAIM})\n\n` +
      `Be SKEPTICAL. Try to REFUTE this claim. ≥${REFUTATIONS_REQUIRED}/${VOTES_PER_CLAIM} refutations kill it.\n\n` +
      `## Research question\n${QUESTION}\n\n` +
      `## Claim under review\n"${claim.claim}"\n\n` +
      `**Source:** ${claim.sourceUrl} (${claim.sourceQuality})\n` +
      `**Supporting quote:** "${claim.quote}"\n\n` +
      `## Checklist\n` +
      `1. Is the claim actually supported by the quote, or is it an overreach/misread?\n` +
      `2. WebSearch for contradicting evidence — does any credible source dispute or heavily qualify this?\n` +
      `3. Is the source quality sufficient for the claim's strength? (extraordinary claims need primary sources)\n` +
      `4. Is the claim outdated? (check dates — old claims about fast-moving fields are suspect)\n` +
      `5. Is this a marketing claim / press release / cherry-picked benchmark / forum speculation?\n\n` +
      `**refuted=true** if: unsupported by quote / contradicted / low-quality source for strong claim / outdated / marketing fluff.\n` +
      `**refuted=false** ONLY if: claim is well-supported, current, and source quality matches claim strength.\n` +
      `Default to refuted=true if uncertain. Evidence MUST be specific.`;

    // ── Pipeline: search → dedup → fetch+extract (no barrier) ─────────────────────
    const searchResults = await pipeline(
      scope.angles,

      // Stage 1 — Search: one WebSearch agent per angle. `angle` is the pipeline item, typed
      // from scope.angles (the SCOPE_SCHEMA inference) — no cast.
      async (angle) => {
        const r = await agent(SEARCH_PROMPT(angle), {
          label: `search:${angle.label}`,
          phase: "Search",
          schema: SEARCH_SCHEMA,
        });
        if (!r) return null;
        log(`${angle.label}: ${r.results.length} results`);
        return { angle: angle.label, results: r.results } satisfies AngleResults;
      },

      // Stage 2 — URL-dedup + fetch slot budgeting, then fan out fetchers. `searchResult` is
      // stage 1's return (AngleResults | null) — the typed pipeline threads it here.
      async (searchResult): Promise<Array<FetchedSource | null>> => {
        if (!searchResult) return [];
        const sorted = searchResult.results.toSorted((a, b) => relRank[a.relevance] - relRank[b.relevance]);
        const novel = sorted.filter((r) => {
          const key = normURL(r.url);
          if (seen.has(key)) {
            dupes.push({ ...r, angle: searchResult.angle });
            return false;
          }
          if (fetchSlots <= 0 && relRank[r.relevance] >= 1) {
            budgetDropped.push({ ...r, angle: searchResult.angle });
            return false;
          }
          seen.set(key, { angle: searchResult.angle, title: r.title });
          fetchSlots--;
          return true;
        });
        if (novel.length < searchResult.results.length) {
          log(
            `${searchResult.angle}: ${novel.length} novel (${searchResult.results.length - novel.length} filtered)`,
          );
        }
        return parallel(
          novel.map((source) => async (): Promise<FetchedSource | null> => {
            const host = hostOf(source.url) ?? "unknown";
            try {
              const ext = await agent(FETCH_PROMPT(source, searchResult.angle), {
                label: `fetch:${host}`,
                phase: "Fetch",
                schema: EXTRACT_SCHEMA,
              });
              // User-skip → null; drop it (filtered by .flat().filter(Boolean)) rather than
              // mislabeling it "unreliable" in the catch below.
              if (!ext) return null;
              return {
                url: source.url,
                title: source.title,
                angle: searchResult.angle,
                sourceQuality: ext.sourceQuality,
                publishDate: ext.publishDate ?? "",
                claims: ext.claims.map((c) => ({
                  ...c,
                  sourceUrl: source.url,
                  sourceQuality: ext.sourceQuality,
                })),
              };
            } catch (e) {
              log(`fetch failed: ${source.url} — ${e instanceof Error ? e.message : String(e)}`);
              return {
                url: source.url,
                title: source.title,
                angle: searchResult.angle,
                sourceQuality: "unreliable",
                publishDate: "",
                claims: [],
              };
            }
          }),
        );
      },
    );

    // pipeline() yields one entry per angle (or null if that angle's chain threw); stage 2
    // returned an array of sources per angle. Typed end-to-end — no cast.
    const perAngle = searchResults;
    const allSources = perAngle.flat().filter((s): s is FetchedSource => s !== null);
    const allClaims = allSources.flatMap((s) => s.claims);
    const impRank: Record<"central" | "supporting" | "tangential", number> = {
      central: 0,
      supporting: 1,
      tangential: 2,
    };
    const qualRank: Record<string, number> = { primary: 0, secondary: 1, blog: 2, forum: 3, unreliable: 4 };

    const rankedClaims = allClaims
      .toSorted(
        (a, b) =>
          impRank[a.importance] - impRank[b.importance] ||
          (qualRank[a.sourceQuality] ?? 9) - (qualRank[b.sourceQuality] ?? 9),
      )
      .slice(0, MAX_VERIFY_CLAIMS);

    log(`Fetched ${allSources.length} sources → ${allClaims.length} claims → verifying top ${rankedClaims.length}`);

    if (rankedClaims.length === 0) {
      return {
        question: QUESTION,
        summary: `No claims extracted. ${allSources.length} sources fetched, all empty/failed. ${dupes.length} URL dupes, ${budgetDropped.length} budget-dropped.`,
        findings: [],
        refuted: [],
        sources: allSources.map((s) => ({ url: s.url, quality: s.sourceQuality })),
        stats: { angles: scope.angles.length, sources: allSources.length, claims: 0, dupes: dupes.length },
      };
    }

    // ── Verify: 3-vote adversarial ────────────────────────────────────────────────
    // Barrier here is intentional — the claim pool must be fully assembled before
    // ranking/verification.
    phase("Verify");
    const voted = (
      await parallel(
        rankedClaims.map((claim) => async () => {
          const verdicts = await parallel(
            Array.from({ length: VOTES_PER_CLAIM }, (_unused, v) => () =>
              agent(VERIFY_PROMPT(claim, v), {
                label: `v${v}:${claim.claim.slice(0, 40)}`,
                phase: "Verify",
                schema: VERDICT_SCHEMA,
              }),
            ),
          );
          // A vote can be null (user-skip or agent error) — treat as abstain.
          const valid = verdicts.filter((x): x is z.infer<typeof VERDICT_SCHEMA> => x !== null);
          const refuted = valid.filter((x) => x.refuted).length;
          // Survive only if actually adjudicated: a quorum of valid votes AND fewer than
          // REFUTATIONS_REQUIRED refuting. Too many abstentions = unverified, which must NOT
          // pass into the report (else all-abstain → refuted=0 → false survive).
          const abstained = VOTES_PER_CLAIM - valid.length;
          const survives = valid.length >= REFUTATIONS_REQUIRED && refuted < REFUTATIONS_REQUIRED;
          log(
            `"${claim.claim.slice(0, 50)}…": ${valid.length - refuted}-${refuted}` +
              `${abstained > 0 ? ` (${abstained} abstain)` : ""} ${survives ? "✓" : "✗"}`,
          );
          return { ...claim, verdicts: valid, refutedVotes: refuted, survives };
        }),
      )
    ).filter((x): x is NonNullable<typeof x> => x !== null);

    const confirmed = voted.filter((c) => c.survives);
    const killed = voted.filter((c) => !c.survives);
    log(`Verify done: ${voted.length} claims → ${confirmed.length} confirmed, ${killed.length} killed`);

    const refutedReport = killed.map((c) => ({
      claim: c.claim,
      vote: `${c.verdicts.length - c.refutedVotes}-${c.refutedVotes}`,
      source: c.sourceUrl,
    }));

    if (confirmed.length === 0) {
      return {
        question: QUESTION,
        summary: `All ${voted.length} claims refuted by adversarial verification. Research inconclusive — sources may be low-quality or claims overstated.`,
        findings: [],
        refuted: refutedReport,
        sources: allSources.map((s) => ({ url: s.url, quality: s.sourceQuality, claimCount: s.claims.length })),
        stats: {
          angles: scope.angles.length,
          sources: allSources.length,
          claims: allClaims.length,
          verified: voted.length,
          confirmed: 0,
          killed: killed.length,
        },
      };
    }

    // ── Synthesize ──────────────────────────────────────────────────────────────
    phase("Synthesize");
    const confRank: Record<"high" | "medium" | "low", number> = { high: 0, medium: 1, low: 2 };
    const block = confirmed
      .map((c, i) => {
        const best =
          c.verdicts
            .filter((v) => !v.refuted)
            .toSorted((a, b) => confRank[a.confidence] - confRank[b.confidence])[0] ?? c.verdicts[0];
        return (
          `### [${i}] ${c.claim}\n` +
          `Vote: ${c.verdicts.length - c.refutedVotes}-${c.refutedVotes} · Source: ${c.sourceUrl} (${c.sourceQuality})\n` +
          `Quote: "${c.quote}"\nVerifier evidence (${best?.confidence ?? "low"}): ${best?.evidence ?? ""}\n`
        );
      })
      .join("\n");

    const killedBlock =
      killed.length > 0
        ? `\n## Refuted claims (for transparency)\n` +
          killed
            .map((c) => `- "${c.claim}" (${c.sourceUrl}, vote ${c.verdicts.length - c.refutedVotes}-${c.refutedVotes})`)
            .join("\n")
        : "";

    const report = await agent(
      `## Synthesis: research report\n\n` +
        `**Question:** ${QUESTION}\n\n` +
        `${confirmed.length} claims survived ${VOTES_PER_CLAIM}-vote adversarial verification. Merge semantic duplicates and synthesize.\n\n` +
        `## Confirmed claims\n${block}\n${killedBlock}\n\n` +
        `## Instructions\n` +
        `1. Identify claims that say the same thing — merge them, combine their sources.\n` +
        `2. Group related claims into coherent findings. Each finding should directly address the research question.\n` +
        `3. Assign confidence per finding: high (multiple primary sources, unanimous votes), medium (secondary sources or split votes), low (single source or blog-quality).\n` +
        `4. Write a 3-5 sentence executive summary answering the research question.\n` +
        `5. Note caveats: what's uncertain, what sources were weak, what time-sensitivity applies.\n` +
        `6. List 2-4 open questions that emerged but weren't answered.`,
      { label: "synthesize", phase: "Synthesize", schema: REPORT_SCHEMA },
    );

    if (!report) {
      // Synthesis skipped/errored — salvage the verified claims raw rather than throwing
      // on report.findings and discarding the whole run.
      return {
        question: QUESTION,
        summary: `Synthesis step was skipped or failed — returning ${confirmed.length} verified claims unmerged.`,
        findings: [],
        confirmed: confirmed.map((c) => ({
          claim: c.claim,
          source: c.sourceUrl,
          quote: c.quote,
          vote: `${c.verdicts.length - c.refutedVotes}-${c.refutedVotes}`,
        })),
        refuted: refutedReport,
        sources: allSources.map((s) => ({ url: s.url, quality: s.sourceQuality, claimCount: s.claims.length })),
        stats: {
          angles: scope.angles.length,
          sources: allSources.length,
          claims: allClaims.length,
          verified: voted.length,
          confirmed: confirmed.length,
          killed: killed.length,
          afterSynthesis: 0,
        },
      };
    }

    return {
      question: QUESTION,
      ...report,
      refuted: refutedReport,
      sources: allSources.map((s) => ({
        url: s.url,
        quality: s.sourceQuality,
        angle: s.angle,
        claimCount: s.claims.length,
      })),
      stats: {
        angles: scope.angles.length,
        sourcesFetched: allSources.length,
        claimsExtracted: allClaims.length,
        claimsVerified: voted.length,
        confirmed: confirmed.length,
        killed: killed.length,
        afterSynthesis: report.findings.length,
        urlDupes: dupes.length,
        budgetDropped: budgetDropped.length,
        agentCalls: 1 + scope.angles.length + allSources.length + voted.length * VOTES_PER_CLAIM + 1,
      },
    };
  },
});
