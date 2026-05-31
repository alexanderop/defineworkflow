// URL/dedup helpers and rank maps. The sandbox injects `URL`, so `new URL()` works after
// bundling (falls back to the raw string on a malformed URL rather than throwing).

export const hostOf = (u: string): string | undefined => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

export const normURL = (u: string): string => {
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/$/, "");
    return (host + path).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};

export const relRank: Record<"high" | "medium" | "low", number> = { high: 0, medium: 1, low: 2 };

export const impRank: Record<"central" | "supporting" | "tangential", number> = {
  central: 0,
  supporting: 1,
  tangential: 2,
};

export const qualRank: Record<string, number> = { primary: 0, secondary: 1, blog: 2, forum: 3, unreliable: 4 };

export const confRank: Record<"high" | "medium" | "low", number> = { high: 0, medium: 1, low: 2 };
