export interface Budget {
  readonly total: number | null;
  spent(): number;
  remaining(): number;
  record(outputTokens: number): void;
}

export function createBudget(total: number | null): Budget {
  let used = 0;
  return {
    total,
    spent: () => used,
    remaining: () => (total === null ? Infinity : Math.max(0, total - used)),
    record: (outputTokens) => {
      used += outputTokens;
    },
  };
}
