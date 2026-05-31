// A deep-research harness as a multi-file workflow: decompose a question into search
// angles, fan out web searches, fetch + extract falsifiable claims, then put every claim
// through 3-vote adversarial verification before synthesizing a cited report. Ported from
// a bughunter-style architecture — WebSearch/WebFetch instead of git/grep.
//
// This is the slim ENTRY file. The schemas, type shapes, prompt builders, and URL/rank
// helpers live in sibling files (./schemas, ./types, ./prompts, ./lib), imported with
// relative paths and bundled in by the CLI before the sandbox runs.
//
// The shape is: Scope → pipeline(Search → URL-dedup → Fetch+Extract) → Verify → Synthesize.
// The middle uses pipeline() so each search angle flows search → dedup → fetch
// INDEPENDENTLY (no barrier); the Verify step is an intentional barrier because the
// full claim pool must be assembled before ranking and voting.
//
// Run it (real agents on the Claude Code harness, uses tokens + web search):
//   workflow run packages/examples/src/deep-research/deep-research.workflow.ts \
//     --args '"How durable are LLM-based coding agents in production?"' --yes
//   workflow run packages/examples/src/deep-research/deep-research.workflow.ts \
//     --args '{"question":"Is RISC-V ready for laptops in 2026?"}' --yes
//
// Iterate on the control flow with NO agents/tokens spent:
//   workflow run packages/examples/src/deep-research/deep-research.workflow.ts --mock

import { agent, args, defineWorkflow, log, parallel, phase, pipeline, z } from "defineworkflow";
import {
  SCOPE_SCHEMA,
  SEARCH_SCHEMA,
  EXTRACT_SCHEMA,
  VERDICT_SCHEMA,
  REPORT_SCHEMA,
} from "./schemas.js";
import type { SearchHit, AngleResults, FetchedSource } from "./types.js";
import { hostOf, normURL, relRank, impRank, qualRank, confRank } from "./lib.js";
import {
  scopePrompt,
  searchPrompt,
  fetchPrompt,
  verifyPrompt,
  synthesizePrompt,
} from "./prompts.js";

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
    const scope = await agent(scopePrompt(QUESTION), {
      label: "scope",
      phase: "Scope",
      schema: SCOPE_SCHEMA,
    });
    if (!scope) {
      return { error: "Scope agent returned no result — cannot decompose the research question." };
    }
    log(
      `Decomposed into ${scope.angles.length} angles: ${scope.angles.map((a) => a.label).join(", ")}`,
    );

    // ── Dedup state — accumulates across searchers as they complete ───────────────
    const seen = new Map<string, { angle: string; title: string }>();
    const dupes: Array<SearchHit & { angle: string }> = [];
    const budgetDropped: Array<SearchHit & { angle: string }> = [];
    let fetchSlots = MAX_FETCH;

    // ── Pipeline: search → dedup → fetch+extract (no barrier) ─────────────────────
    const searchResults = await pipeline(
      scope.angles,

      // Stage 1 — Search: one WebSearch agent per angle. `angle` is the pipeline item, typed
      // from scope.angles (the SCOPE_SCHEMA inference) — no cast.
      async (angle) => {
        const r = await agent(searchPrompt(angle, QUESTION), {
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
        const sorted = searchResult.results.toSorted(
          (a, b) => relRank[a.relevance] - relRank[b.relevance],
        );
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
              const ext = await agent(fetchPrompt(source, searchResult.angle, QUESTION), {
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

    const rankedClaims = allClaims
      .toSorted(
        (a, b) =>
          impRank[a.importance] - impRank[b.importance] ||
          (qualRank[a.sourceQuality] ?? 9) - (qualRank[b.sourceQuality] ?? 9),
      )
      .slice(0, MAX_VERIFY_CLAIMS);

    log(
      `Fetched ${allSources.length} sources → ${allClaims.length} claims → verifying top ${rankedClaims.length}`,
    );

    if (rankedClaims.length === 0) {
      return {
        question: QUESTION,
        summary: `No claims extracted. ${allSources.length} sources fetched, all empty/failed. ${dupes.length} URL dupes, ${budgetDropped.length} budget-dropped.`,
        findings: [],
        refuted: [],
        sources: allSources.map((s) => ({ url: s.url, quality: s.sourceQuality })),
        stats: {
          angles: scope.angles.length,
          sources: allSources.length,
          claims: 0,
          dupes: dupes.length,
        },
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
            Array.from(
              { length: VOTES_PER_CLAIM },
              (_unused, v) => () =>
                agent(verifyPrompt(claim, v, QUESTION, VOTES_PER_CLAIM, REFUTATIONS_REQUIRED), {
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
    log(
      `Verify done: ${voted.length} claims → ${confirmed.length} confirmed, ${killed.length} killed`,
    );

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
        sources: allSources.map((s) => ({
          url: s.url,
          quality: s.sourceQuality,
          claimCount: s.claims.length,
        })),
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
    const block = confirmed
      .map((c, i) => {
        const best =
          c.verdicts
            .filter((v) => !v.refuted)
            .toSorted((a, b) => confRank[a.confidence] - confRank[b.confidence])[0] ??
          c.verdicts[0];
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
            .map(
              (c) =>
                `- "${c.claim}" (${c.sourceUrl}, vote ${c.verdicts.length - c.refutedVotes}-${c.refutedVotes})`,
            )
            .join("\n")
        : "";

    const report = await agent(
      synthesizePrompt(QUESTION, block, killedBlock, VOTES_PER_CLAIM, confirmed.length),
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
        sources: allSources.map((s) => ({
          url: s.url,
          quality: s.sourceQuality,
          claimCount: s.claims.length,
        })),
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
        agentCalls:
          1 + scope.angles.length + allSources.length + voted.length * VOTES_PER_CLAIM + 1,
      },
    };
  },
});
