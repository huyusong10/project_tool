

import type { Session } from "./types";

export function sessionAccessKey(session: Session) {
  return session.authenticated ? JSON.stringify([
    session.accountId || session.username, session.personId, session.globalRole, session.role,
    session.mustChangePassword, [...session.managedProjectIds].sort(),
  ]) : 'guest';
}
