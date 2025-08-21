export function stringifySmall(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 500 ? s.slice(0, 500) + "…" : s;
  } catch {
    return String(v);
  }
}
