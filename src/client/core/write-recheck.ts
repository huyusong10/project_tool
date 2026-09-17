/** Storage is best-effort; callers retain the pending request in memory. */
export function readRecheck<T>(key: string, decode: (value: unknown) => T | null): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : decode(JSON.parse(raw));
  } catch { return null; }
}

export function persistRecheck(key: string, value: unknown | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* The open editor still holds the request and submission lock. */ }
}

/** Old flag receipts use the literal "1"; keep that on-disk format. */
export function readRecheckFlag(key: string): boolean {
  return readRecheck(key, value => value === 1) === true;
}

export function persistRecheckFlag(key: string, required: boolean): void {
  persistRecheck(key, required ? 1 : null);
}

export type WriteOutcome = 'applied' | 'not-applied' | 'conflict';

/** A changed version without matching content requires human review, not a retry. */
export function versionedWriteOutcome(originalVersion: number | string, currentVersion: number | string, matches = false): WriteOutcome {
  return matches ? 'applied' : originalVersion === currentVersion ? 'not-applied' : 'conflict';
}

/** Only reads. Authorization/network errors propagate and never clear the receipt. */
export async function queryWriteResult<Request, Result>(
  request: Request,
  read: () => Promise<Result>,
  decide: (request: Request, latest: Result) => WriteOutcome,
) {
  const latest = await read();
  return { latest, outcome: decide(request, latest) };
}
