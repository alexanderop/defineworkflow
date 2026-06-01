// Type-only shapes (erased by the compiler) used to type the accumulator state and the
// FetchedSource literals. The pipeline infers each stage's prev/item from the zod
// schemas, so these are no longer needed to cast `unknown` stage results.
export interface SearchHit {
  url: string;
  title: string;
  snippet?: string | undefined;
  relevance: "high" | "medium" | "low";
}

export interface AngleResults {
  angle: string;
  results: SearchHit[];
}

export interface Claim {
  claim: string;
  quote: string;
  importance: "central" | "supporting" | "tangential";
  sourceUrl: string;
  sourceQuality: string;
}

export interface FetchedSource {
  url: string;
  title: string;
  angle: string;
  sourceQuality: "primary" | "secondary" | "blog" | "forum" | "unreliable";
  publishDate: string;
  claims: Claim[];
}
