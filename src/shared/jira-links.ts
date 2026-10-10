const issueKey = /^[A-Z][A-Z0-9_]*-\d+$/i;

export type JiraEntry = { key: string; url: string; source: 'binding' | 'reference' };

/** Only explicit URLs on the configured site become navigation entries. Title hints never do. */
export function jiraReferenceEntries(links: Array<{ url: string }>, site: string): JiraEntry[] {
  try { const base = new URL(site); if (!/^https?:$/.test(base.protocol) || base.username || base.password) return []; } catch { return []; }
  const entries = new Map<string, JiraEntry>();
  for (const link of links) {
    const key = jiraKeyFromUrl(link.url, site);
    if (key && !entries.has(key)) entries.set(key, { key, url: site.replace(/\/+$/, '') + '/browse/' + key, source: 'reference' });
  }
  return [...entries.values()];
}

export function jiraKeyFromUrl(value: string, site: string): string | null {
  try {
    const url = new URL(value), base = new URL(site);
    if (url.origin !== base.origin || url.username || url.password) return null;
    const prefix = base.pathname.replace(/\/$/, '');
    if (prefix && !url.pathname.startsWith(prefix + '/')) return null;
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    const pathKey = /^\/browse\/([^/]+)\/?$/i.exec(path)?.[1]
      || /^\/projects\/[^/]+\/issues\/([^/]+)\/?$/i.exec(path)?.[1];
    const selected = url.searchParams.getAll('selectedIssue');
    const keys = [...new Set([pathKey, ...selected].filter((key): key is string => !!key).map(key => key.toUpperCase()))];
    return keys.length === 1 && issueKey.test(keys[0]) ? keys[0] : null;
  } catch { return null; }
}

export function jiraKeysFromTitle(title: string): string[] {
  return [...new Set([...title.matchAll(/(?<![A-Z0-9_-])([A-Z][A-Z0-9_]*-\d+)(?![A-Z0-9_-])/gi)].map(match => match[1].toUpperCase()))];
}

export function normalizedJiraTitle(title: string): string {
  return title.replace(/\b[A-Z][A-Z0-9_]*-\d+\b/gi, '').replace(/【[^】]*】|\[[^\]]*\]/g, '').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase();
}
