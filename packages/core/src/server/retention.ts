import type { CaseRecord } from '../domain';
import { checkQuota } from './billing';
import { orgLock, purgeSourcesIn, workspaceIn } from './cases';
import { transaction, type Database } from './db';
import { retainedMarker, type RemovedSource } from './retained-evidence';
import { removeOriginal } from './providers/storage';
import { conflict, missing, required } from './validation';

type SourceKind = RemovedSource['kind'];
export const retentionMs = () => Math.max(1, Number(process.env.JUDE_DELETE_GRACE_DAYS) || 30) * 86_400_000;

async function touch(db: Database, record: CaseRecord) {
  const now = Date.now();
  await db.query('UPDATE cases SET record=$1,version=version+1,updated_at=$2 WHERE id=$3', [
    JSON.stringify({ ...record, updated: new Date(now).toISOString() }),
    now,
    record.id,
  ]);
}

export async function removeSourceIn(
  db: Database,
  org: string,
  caseId: string,
  kind: SourceKind,
  id: string,
) {
  await orgLock(db, org);
  const w = await workspaceIn(db, org, caseId, true);
  required(w[kind] as { id: string }[], (item) => item.id === id);
  if (kind === 'hearings' && w.hearings.some((h) => h.id === id && h.mode === 'live'))
    conflict('End the live hearing before deleting its recording.');
  const passages = new Set(w.passages.filter((p) => kind === 'documents' && p.docId === id).map((p) => p.id));
  const citedFindings = w.findings.filter((f) => f.sources.some((s) => passages.has(s.passageId))).length;
  await db.query('INSERT INTO case_trash(case_id,kind,id,body,deleted_at) VALUES($1,$2,$3,$4,$5)', [
    caseId,
    kind,
    id,
    retainedMarker,
    Date.now(),
  ]);
  await touch(db, w.caseRecord);
  return { ok: true, id, citedFindings };
}

export async function restoreSourceIn(
  db: Database,
  org: string,
  caseId: string,
  kind: SourceKind,
  id: string,
) {
  const w = await workspaceIn(db, org, caseId, true);
  const [item] = await db.query<{ body: string }>(
    'SELECT body FROM case_entities WHERE case_id=$1 AND kind=$2 AND id=$3',
    [caseId, kind, id],
  );
  if (!item) missing();
  const [bytes] = await db.query<{ size: number | string }>(
    "SELECT COALESCE(SUM(n),0) AS size FROM (SELECT byte_length AS n FROM attachments WHERE case_id=$1 AND entity_id=$2 AND kind=$3 UNION ALL SELECT bytes AS n FROM voice_turns WHERE case_id=$1 AND hearing_id=$2 AND object_key IS NOT NULL AND $4='hearings') AS retained",
    [caseId, id, kind === 'documents' ? 'original' : 'audio', kind],
  );
  await checkQuota(db, org, 'storage', Number(bytes.size) / 1e9);
  await db.query('DELETE FROM case_trash WHERE case_id=$1 AND kind=$2 AND id=$3', [caseId, kind, id]);
  await touch(db, w.caseRecord);
  return JSON.parse(item.body);
}

async function queueOriginals(db: Database, caseId: string, id?: string) {
  const args = id ? [caseId, id] : [caseId];
  await db.query(
    'INSERT INTO purge_objects(object_key,available_at) SELECT object_key,0 FROM attachments WHERE case_id=$1' +
      (id ? ' AND entity_id=$2' : '') +
      ' ON CONFLICT(object_key) DO NOTHING',
    args,
  );
  await db.query(
    'INSERT INTO purge_objects(object_key,available_at) SELECT object_key,0 FROM voice_turns WHERE case_id=$1 AND object_key IS NOT NULL' +
      (id ? ' AND hearing_id=$2' : '') +
      ' ON CONFLICT(object_key) DO NOTHING',
    args,
  );
}

/** Commit the private object keys before deleting their database owners. All object deletes are retryable. */
export async function purgeExpired(now = Date.now()) {
  const cutoff = now - retentionMs();
  const cases = await transaction((db) =>
    db.query<{ id: string; org_id: string }>(
      'SELECT id,org_id FROM cases WHERE deleted_at IS NOT NULL AND deleted_at<$1 ORDER BY deleted_at LIMIT 32',
      [cutoff],
    ),
  );
  for (const c of cases)
    await transaction(async (db) => {
      await orgLock(db, c.org_id);
      const [due] = await db.query('SELECT id FROM cases WHERE id=$1 AND deleted_at<$2' + db.forUpdate, [
        c.id,
        cutoff,
      ]);
      if (!due) return;
      await queueOriginals(db, c.id);
      // Each cached case mutation is scoped either to the case path or returns the case ID.
      await db.query(
        "DELETE FROM idempotency WHERE org_id=$1 AND (scope=$2 OR substr(scope,1,$3)=$4 OR (scope='cases' AND result LIKE $5))",
        [c.org_id, c.id, c.id.length + 1, c.id + '/', '%"id":' + JSON.stringify(c.id) + '%'],
      );
      await db.query('DELETE FROM cases WHERE id=$1', [c.id]);
    });
  const trash = await transaction((db) =>
    db.query<{ case_id: string; org_id: string; kind: string; id: string }>(
      'SELECT t.case_id,c.org_id,t.kind,t.id FROM case_trash t JOIN cases c ON c.id=t.case_id WHERE t.deleted_at<$1 AND c.deleted_at IS NULL ORDER BY t.deleted_at LIMIT 64',
      [cutoff],
    ),
  );
  for (const item of trash)
    await transaction(async (db) => {
      await orgLock(db, item.org_id);
      const [c] = await db.query('SELECT id FROM cases WHERE id=$1 AND deleted_at IS NULL' + db.forUpdate, [
        item.case_id,
      ]);
      if (!c) return;
      const [row] = await db.query<{ body: string }>(
        'SELECT body FROM case_trash WHERE case_id=$1 AND kind=$2 AND id=$3 AND deleted_at<$4' + db.forUpdate,
        [item.case_id, item.kind, item.id, cutoff],
      );
      if (!row) return;
      if (item.kind === 'documents' || item.kind === 'hearings') {
        if (row.body === retainedMarker)
          await purgeSourcesIn(db, item.org_id, item.case_id, [{ kind: item.kind, id: item.id }]);
        await queueOriginals(db, item.case_id, item.id);
        await db.query('DELETE FROM attachments WHERE case_id=$1 AND entity_id=$2', [item.case_id, item.id]);
        if (item.kind === 'hearings') {
          await db.query('DELETE FROM voice_turns WHERE case_id=$1 AND hearing_id=$2', [
            item.case_id,
            item.id,
          ]);
          await db.query('DELETE FROM voice_leases WHERE case_id=$1 AND hearing_id=$2', [
            item.case_id,
            item.id,
          ]);
          await db.query('DELETE FROM voice_diarization_jobs WHERE case_id=$1 AND hearing_id=$2', [
            item.case_id,
            item.id,
          ]);
        }
      }
      // A completed creation must not replay an expired source or its original URL.
      const scopes = [item.case_id + '/' + item.kind, item.case_id + '/voice/upload'];
      const cached = await db.query<{ scope: string; key: string; result: string }>(
        'SELECT scope,key,result FROM idempotency WHERE org_id=$1 AND scope IN ($2,$3)',
        [item.org_id, ...scopes],
      );
      for (const entry of cached)
        if (JSON.parse(entry.result)?.id === item.id)
          await db.query('DELETE FROM idempotency WHERE org_id=$1 AND scope=$2 AND key=$3', [
            item.org_id,
            entry.scope,
            entry.key,
          ]);
      await db.query('DELETE FROM case_trash WHERE case_id=$1 AND kind=$2 AND id=$3', [
        item.case_id,
        item.kind,
        item.id,
      ]);
    });
  const objects = await transaction((db) =>
    db.query<{ object_key: string; attempts: number }>(
      'SELECT object_key,attempts FROM purge_objects WHERE available_at<=$1 ORDER BY available_at LIMIT 64',
      [now],
    ),
  );
  for (const item of objects) {
    try {
      await removeOriginal(item.object_key);
      await transaction((db) => db.query('DELETE FROM purge_objects WHERE object_key=$1', [item.object_key]));
    } catch {
      await transaction((db) =>
        db.query('UPDATE purge_objects SET attempts=attempts+1,available_at=$1 WHERE object_key=$2', [
          now + Math.min(86_400_000, 30_000 * 2 ** Math.min(item.attempts, 12)),
          item.object_key,
        ]),
      );
    }
  }
  return { cases: cases.length, records: trash.length, objects: objects.length };
}
