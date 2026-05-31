import type { SearchHit, Claim } from "./types.js";

// Prompt builders. They close over the research question and the run constants in the
// single-file version; here those are explicit parameters so the strings stay identical.

export const scopePrompt = (question: string): string =>
  `Decompose this research question into complementary search angles.\n\n` +
  `## Question\n${question}\n\n` +
  `## Task\n` +
  `Generate 5 distinct web search queries that together cover the question from different angles. ` +
  `Pick angles that suit the question's domain. Examples:\n` +
  `- broad/primary · academic/technical · recent news · contrarian/skeptical · practitioner/implementation\n` +
  `- For medical: anatomy · common causes · serious differentials · authoritative refs · red flags\n` +
  `- For tech: state-of-art · benchmarks · limitations · industry adoption · cost/tradeoffs\n\n` +
  `Make queries specific enough to surface high-signal results. Avoid redundancy.\n` +
  `Return: the question (verbatim or lightly normalized), a 1-2 sentence decomposition strategy, and the angles.`;

export const searchPrompt = (
  angle: { label: string; query: string; rationale?: string | undefined },
  question: string,
): string =>
  `## Web Searcher: ${angle.label}\n\n` +
  `Research question: "${question}"\n\n` +
  `Your angle: **${angle.label}** — ${angle.rationale ?? ""}\n` +
  `Search query: \`${angle.query}\`\n\n` +
  `## Task\nUse WebSearch with the query above (or a refined version). Return the top 4-6 most relevant results.\n` +
  `Rank by relevance to the ORIGINAL question, not just the search query. Skip obvious SEO spam/content farms.\n` +
  `Include a short snippet capturing why each result is relevant.`;

export const fetchPrompt = (source: SearchHit, angle: string, question: string): string =>
  `## Source Extractor\n\n` +
  `Research question: "${question}"\n\n` +
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

export const verifyPrompt = (
  claim: Claim,
  v: number,
  question: string,
  votesPerClaim: number,
  refutationsRequired: number,
): string =>
  `## Adversarial Claim Verifier (voter ${v + 1}/${votesPerClaim})\n\n` +
  `Be SKEPTICAL. Try to REFUTE this claim. ≥${refutationsRequired}/${votesPerClaim} refutations kill it.\n\n` +
  `## Research question\n${question}\n\n` +
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

export const synthesizePrompt = (
  question: string,
  confirmedBlock: string,
  killedBlock: string,
  votesPerClaim: number,
  confirmedCount: number,
): string =>
  `## Synthesis: research report\n\n` +
  `**Question:** ${question}\n\n` +
  `${confirmedCount} claims survived ${votesPerClaim}-vote adversarial verification. Merge semantic duplicates and synthesize.\n\n` +
  `## Confirmed claims\n${confirmedBlock}\n${killedBlock}\n\n` +
  `## Instructions\n` +
  `1. Identify claims that say the same thing — merge them, combine their sources.\n` +
  `2. Group related claims into coherent findings. Each finding should directly address the research question.\n` +
  `3. Assign confidence per finding: high (multiple primary sources, unanimous votes), medium (secondary sources or split votes), low (single source or blog-quality).\n` +
  `4. Write a 3-5 sentence executive summary answering the research question.\n` +
  `5. Note caveats: what's uncertain, what sources were weak, what time-sensitivity applies.\n` +
  `6. List 2-4 open questions that emerged but weren't answered.`;
