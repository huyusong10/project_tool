import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';

export const performanceSamples: Array<{name: string; budgetMs: number; samplesMs: number[]; medianMs: number; slowestMs: number}> = [];

/** Warm once, then retain every sample; a fast median cannot hide a slow request. */
export function measureScenario<T>(name: string, budgetMs: number, read: () => T, verify: (value: T) => void) {
  verify(read());
  const samplesMs: number[] = [];
  for (let index = 0; index < 5; index++) {
    const start = performance.now(), value = read();
    samplesMs.push(performance.now() - start);
    verify(value);
  }
  const sorted = [...samplesMs].sort((a,b)=>a-b);
  const sample = { name, budgetMs, samplesMs, medianMs: sorted[2], slowestMs: sorted[4] };
  performanceSamples.push(sample);
  console.info(`${name}: median ${sample.medianMs.toFixed(1)} ms, slowest ${sample.slowestMs.toFixed(1)} ms / ${budgetMs} ms`);
  for (const elapsed of samplesMs) expect(elapsed, name).toBeLessThan(budgetMs);
}

export function writePerformanceReport() {
  const directory=path.resolve('coverage/performance');
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'samples.json'),JSON.stringify(performanceSamples,null,2)+'\n');
}
