import type { Workspace } from './domain';
import { numberGroupedVoices } from './speakers';

export const workspaceGroups = [
  'hearings', 'speakers', 'statements', 'findings', 'documents', 'passages',
  'connections', 'boards', 'threads', 'legal', 'replies',
] as const;
export type WorkspaceGroup = (typeof workspaceGroups)[number];
export type WorkspaceUpsert = {
  [K in WorkspaceGroup]: { kind: K; ordinal: number; value: Workspace[K][number] }
}[WorkspaceGroup];
export type WorkspaceSync =
  | { kind: 'snapshot'; cursor: string; workspace: Workspace }
  | { kind: 'delta'; cursor: string; from: number; version: number; caseRecord: Workspace['caseRecord']; upserts: WorkspaceUpsert[] };

/** Stream revisions contain upserts only. A deletion or reorder requires a new snapshot. */
export function mergeWorkspaceSync(previous: Workspace | undefined, update: WorkspaceSync): Workspace {
  if (update.kind === 'snapshot') return update.workspace;
  if (!previous || previous.version !== update.from || previous.caseRecord.id !== update.caseRecord.id)
    throw new Error('Workspace revision no longer matches its snapshot.');
  const next = { ...previous, version: update.version, caseRecord: update.caseRecord };
  for (const kind of workspaceGroups) {
    const changed = update.upserts.filter(entry => entry.kind === kind);
    if (!changed.length) continue;
    const values = [...previous[kind]] as { id: string }[];
    // Existing ordinals are stable on this path; append order is explicitly supplied by the server.
    for (const entry of changed.sort((a, b) => a.ordinal - b.ordinal)) {
      const index = values.findIndex(value => value.id === entry.value.id);
      if (index >= 0 && index === entry.ordinal) values[index] = entry.value;
      else if (index >= 0) throw new Error('Workspace entity order changed.');
      else if (entry.ordinal === values.length) values.push(entry.value);
      else throw new Error('Workspace entity order changed.');
    }
    (next[kind] as { id: string }[]) = values;
  }
  next.speakers = next.speakers.map(speaker => ({ ...speaker }));
  numberGroupedVoices(next.speakers);
  return next;
}
