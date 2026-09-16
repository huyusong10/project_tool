export type RequirementSource = {title: string; url: string | null; version: string; entries: string[]};

/** Legacy imports repeated the same source for each work item. Keep an index without changing the originals. */
export function requirementSourceIndex(notes: string | null | undefined): RequirementSource[] {
  if (!notes) return [];
  const sources = new Map<string, RequirementSource>();
  for (const block of notes.split(/\r?\n\s*\r?\n(?=原始需求：)/)) {
    const entry = /^原始需求：\s*(.+)$/m.exec(block)?.[1]?.trim();
    const origin = /^出处：\s*(.+)$/m.exec(block)?.[1]?.trim();
    if (!entry || !origin) continue;
    const link = /https?:\/\/\S+/.exec(origin);
    const url = link?.[0] || null;
    const title = link ? origin.slice(0, link.index).trim() || url! : origin;
    const version = (/^版本：\s*(.+)$/m.exec(block)?.[1]?.trim() || '').replace(/\s+(功能需求|DFX需求|验收需求)$/, '');
    const key = JSON.stringify([title, url, version]);
    const source = sources.get(key) || {title, url, version, entries: []};
    if (!source.entries.includes(entry)) source.entries.push(entry);
    sources.set(key, source);
  }
  return [...sources.values()];
}
