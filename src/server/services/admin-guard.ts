

import type { Actor } from '../auth';

import { forbidden } from '../errors';

import { assertAdmin, requireAuthorizationActor } from '../authorization';

export function assertCurrentAdmin(actor: Actor) {
  if (!actor.accountId) {
    if (actor.globalRole !== 'admin') forbidden('此功能仅管理员可用');
    return;
  }
  assertAdmin(requireAuthorizationActor(actor));
}
