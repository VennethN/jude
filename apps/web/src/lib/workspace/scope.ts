import type { SessionInfo } from '@jude/core/domain';

/** Public identifiers for the already-authenticated workspace; never a credential. */
export function workspaceScope(session: SessionInfo | null) {
  return session ? JSON.stringify([session.user.id, session.organization.id]) : '';
}
