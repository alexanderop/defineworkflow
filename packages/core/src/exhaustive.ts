export function assertNever(value: never): never {
  throw new Error(`Unhandled switch case: ${String(value)}`);
}
