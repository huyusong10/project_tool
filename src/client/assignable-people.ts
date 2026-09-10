import type { Person } from './types';

/** Older cached person records may omit accountStatus; explicit unavailable accounts cannot receive work. */
export function isAssignablePerson(person: Person) {
  return Boolean(person.active) && !person.deletedAt && person.projectRole !== 'viewer'
    && person.accountStatus !== 'disabled' && person.accountStatus !== null && !person.accountDeletedAt;
}
