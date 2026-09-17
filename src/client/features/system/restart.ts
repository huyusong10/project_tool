import type { SystemOverview } from '../../../shared/api/system';

export async function waitForServiceRestart(previousStartedAt: string | undefined, operationId: string, signal: AbortSignal) {
  let baseline = previousStartedAt;
  let disconnected = false;
  const deadline = Date.now() + 60_000;
  while (!signal.aborted && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    if (signal.aborted) return false;
    try {
      const response = await fetch(`/api/system/overview?restoreProbe=${Date.now()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
      if (response.status === 401 || response.status === 403) return true;
      if (!response.ok) { disconnected = true; continue; }
      const current = await response.json() as SystemOverview;
      if (operationId && current.lastRestore?.operationId === operationId && current.lastRestore.outcome === 'rolled_back') return true;
      if (!baseline) baseline = current.service.startedAt;
      else if (disconnected || current.service.startedAt !== baseline) return true;
    } catch (error) {
      if (signal.aborted || error instanceof DOMException && error.name === "AbortError") return false;
      disconnected = true;
    }
  }
  return false;
}
