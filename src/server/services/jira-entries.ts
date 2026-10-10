import { jiraReferenceEntries, type JiraEntry } from '../../shared/jira-links';
import { readReferenceLinks } from '../../shared/reference-links';
import { getDatabaseContext } from '../database-context';

export function referenceJiraEntries(links: Parameters<typeof readReferenceLinks>[0], legacy?: string | null) {
  return jiraReferenceEntries(readReferenceLinks(links, legacy), getDatabaseContext().config.jiraBaseUrl);
}

/** Reads only the already-authorized objects; no Jira credentials, network calls or writes. */
export function attachRequirementJiraEntries<T extends { id: string; referenceLinks?: Parameters<typeof readReferenceLinks>[0]; referenceUrl?: string | null; jiraLinks?: JiraEntry[]; jiraKey?: string | null; jiraSite?: string | null }>(requirements: T[]): void {
  for (const requirement of requirements) {
    const entry = requirement.jiraKey && requirement.jiraSite ? jiraReferenceEntries([{ url: requirement.jiraSite.replace(/\/+$/, '') + '/browse/' + requirement.jiraKey }], requirement.jiraSite)[0] : undefined;
    const binding: JiraEntry | undefined = entry ? { ...entry, source: 'binding' } : undefined;
    const references = referenceJiraEntries(requirement.referenceLinks, requirement.referenceUrl);
    requirement.jiraLinks = binding ? [binding, ...references.filter(entry => entry.url !== binding.url)] : references;
    delete requirement.jiraKey; delete requirement.jiraSite;
  }
}
