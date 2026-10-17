/** Human wording for a lyrics timing offset (negative = lyrics shown earlier): "In sync" · "0.5s earlier" · "1.25s later". */
export function describeOffset(ms: number): string {
  if (ms === 0) return "In sync";
  return `${Math.abs(ms) / 1000}s ${ms < 0 ? "earlier" : "later"}`;
}
