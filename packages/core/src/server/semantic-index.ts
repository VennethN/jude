import { randomUUID } from 'node:crypto';
import type { Workspace } from '../domain';
import { insertRows, transaction, type Database } from './db';
import { workspaceIn } from './cases';
import { embedEvidence, embeddingModel, embeddingsConfigured } from './providers/embeddings';
import { semanticSources, type SemanticKind } from './semantic-sources';

export const embeddingDimensions = 1536;
const leaseMs = 120_000, maxAttempts = 4, batchSize = 2;
const quote = (identifier: string) => '"' + identifier.replaceAll('"', '""') + '"';

async function vectorSchema(db: Database) {
  if (!db.forUpdate) return null;
  const [extension] = await db.query<{ schema: string }>(
    "SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'",
  );
  return extension?.schema ?? null;
}

/** PostgreSQL-native vectors need no extension privileges. If an administrator
 * installs pgvector, its typed column is added without discarding native vectors.
 * Keep PostgreSQL DDL outside the shared SQLite/Python migration ledger. */
export async function ensureSemanticStorageIn(db: Database): Promise<boolean> {
  if (!db.forUpdate) return false;
  const [table] = await db.query<{ present: string | null }>("SELECT to_regclass('semantic_vectors') AS present");
  if (!table.present) {
    await db.query('SELECT pg_advisory_xact_lock(1937446202)');
    await db.query(
      'CREATE TABLE IF NOT EXISTS semantic_vectors (' +
        'case_id TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,chunk INTEGER NOT NULL,' +
        'fingerprint TEXT NOT NULL,model TEXT NOT NULL,embedding REAL[] NOT NULL CHECK(cardinality(embedding)=1536),' +
        'PRIMARY KEY(case_id,kind,source_id,chunk),' +
        'FOREIGN KEY(case_id,kind,source_id) REFERENCES semantic_evidence(case_id,kind,source_id) ON DELETE CASCADE)',
    );
  }
  const schema = await vectorSchema(db);
  if (schema) {
    const columns = await db.query("SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('semantic_vectors') AND attname='embedding_vector' AND NOT attisdropped");
    if (!columns.length) {
      await db.query('SELECT pg_advisory_xact_lock(1937446202)');
      await db.query('ALTER TABLE semantic_vectors ADD COLUMN IF NOT EXISTS embedding_vector ' + quote(schema) + '.vector(1536)');
    }
  }
  return true;
}

export async function syncSemanticIndexIn(db: Database, orgId: string, w: Workspace) {
  if (!db.forUpdate) return;
  const [owner] = await db.query<{ org_id: string; deleted_at: number | string | null; version: number }>(
    'SELECT org_id,deleted_at,version FROM cases WHERE id=$1', [w.caseRecord.id],
  );
  if (!owner || owner.org_id !== orgId) return;
  const sources = owner.deleted_at === null ? semanticSources(w) : [];
  const model = embeddingModel(), now = Date.now();
  const prior = await db.query<{ kind: string; source_id: string; fingerprint: string; model: string }>(
    'SELECT kind,source_id,fingerprint,model FROM semantic_evidence WHERE case_id=$1', [w.caseRecord.id],
  );
  const wanted = new Set(sources.map((s) => s.kind + ':' + s.id));
  for (const row of prior) if (!wanted.has(row.kind + ':' + row.source_id))
    await db.query('DELETE FROM semantic_evidence WHERE case_id=$1 AND kind=$2 AND source_id=$3', [w.caseRecord.id, row.kind, row.source_id]);
  const existing = new Map(prior.map((s) => [s.kind + ':' + s.source_id, s]));
  const changed = sources.filter(source => {
    const previous = existing.get(source.kind + ':' + source.id);
    return previous?.fingerprint !== source.fingerprint || previous.model !== model;
  }).map(source => [w.caseRecord.id, source.kind, source.id, source.fingerprint, model, now]);
  await insertRows(db, 'semantic_evidence(case_id,kind,source_id,fingerprint,model,updated_at)', changed,
    "ON CONFLICT(case_id,kind,source_id) DO UPDATE SET fingerprint=excluded.fingerprint,model=excluded.model,status='pending',attempts=0,available_at=0,lease=NULL,lease_until=0,updated_at=excluded.updated_at");
  await db.query(
    'INSERT INTO semantic_case_state(case_id,version,model,synced_at) VALUES($1,$2,$3,$4) ' +
    'ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,model=excluded.model,synced_at=excluded.synced_at',
    [w.caseRecord.id, owner.version, model, now],
  );
}

export async function hasSemanticEvidenceIn(db: Database, orgId: string, caseId: string): Promise<boolean> {
  if (!(await ensureSemanticStorageIn(db))) return false;
  const rows = await db.query(
    "SELECT 1 FROM semantic_vectors v JOIN semantic_evidence e ON e.case_id=v.case_id AND e.kind=v.kind AND e.source_id=v.source_id " +
    "JOIN cases c ON c.id=v.case_id WHERE c.id=$1 AND c.org_id=$2 AND c.synthetic=0 AND c.deleted_at IS NULL " +
    "AND e.status='ready' AND e.fingerprint=v.fingerprint AND e.model=v.model AND e.model=$3 LIMIT 1",
    [caseId, orgId, embeddingModel()],
  );
  return rows.length > 0;
}

export interface SemanticMatch { kind: SemanticKind; id: string; fingerprint: string; score: number }
export function vectorLiteral(vector: readonly number[]) {
  if (vector.length !== embeddingDimensions || vector.some((n) => !Number.isFinite(n)) || !vector.some((n) => n !== 0))
    throw new Error('Embeddings must contain 1536 finite values and have nonzero magnitude.');
  return '[' + vector.join(',') + ']';
}

/** Exact cosine ranking within the authorized case; constraints apply before top K. */
export async function searchSemanticIn(db: Database, options: {
  orgId: string; caseId: string; vector: readonly number[]; limit: number;
  allowed?: readonly { kind: string; id: string }[];
}): Promise<SemanticMatch[]> {
  if (!Number.isFinite(options.limit) || options.limit < 1 || options.allowed?.length === 0) return [];
  if (!(await ensureSemanticStorageIn(db))) return [];
  const schema = await vectorSchema(db);
  vectorLiteral(options.vector);
  const vector = '{' + options.vector.join(',') + '}';
  const args: (string | number | null)[] = [options.caseId, options.orgId, vector, embeddingModel(), Math.min(80, Math.floor(options.limit))];
  let filter = '';
  if (options.allowed) {
    args.push(JSON.stringify(options.allowed));
    filter = ' AND EXISTS (SELECT 1 FROM jsonb_to_recordset($6::jsonb) AS permitted(kind text,id text) WHERE permitted.kind=v.kind AND permitted.id=v.source_id)';
  }
  const cosine = schema
    ? '1 - (COALESCE(v.embedding_vector,v.embedding::' + quote(schema) + '.vector) OPERATOR(' + quote(schema) + '.<=>) $3::real[]::' + quote(schema) + '.vector)'
    : '(SELECT SUM(a::float8*b::float8) / NULLIF(SQRT(SUM(a::float8*a::float8))*SQRT(SUM(b::float8*b::float8)),0) FROM unnest(v.embedding,$3::real[]) AS dimensions(a,b))';
  return db.query<SemanticMatch>(
    'SELECT v.kind,v.source_id AS id,v.fingerprint,MAX(' + cosine + ') AS score ' +
    'FROM semantic_vectors v JOIN semantic_evidence e ON e.case_id=v.case_id AND e.kind=v.kind AND e.source_id=v.source_id ' +
    'JOIN cases c ON c.id=v.case_id ' +
    "WHERE c.id=$1 AND c.org_id=$2 AND c.synthetic=0 AND c.deleted_at IS NULL AND (c.record::jsonb->>'label')='private' " +
    "AND e.status='ready' AND e.fingerprint=v.fingerprint AND e.model=v.model AND e.model=$4" + filter +
    ' GROUP BY v.kind,v.source_id,v.fingerprint ORDER BY score DESC,v.kind,v.source_id LIMIT $5', args,
  );
}

interface IndexJob {
  case_id: string; org_id: string; kind: SemanticKind; source_id: string;
  fingerprint: string; model: string; attempts: number; lease: string;
}

async function reconcileCases() {
  await transaction(async (db) => {
    if (!(await ensureSemanticStorageIn(db))) return;
    const cases = await db.query<{ id: string; org_id: string }>(
      'SELECT c.id,c.org_id FROM cases c LEFT JOIN semantic_case_state s ON s.case_id=c.id ' +
      "WHERE c.synthetic=0 AND c.deleted_at IS NULL AND c.archived=0 AND (s.case_id IS NULL OR s.version<>c.version OR s.model<>$1) " +
      'ORDER BY c.updated_at,c.id LIMIT 4 FOR UPDATE OF c SKIP LOCKED', [embeddingModel()],
    );
    for (const c of cases) await syncSemanticIndexIn(db, c.org_id, await workspaceIn(db, c.org_id, c.id));
  });
}

async function claimJobs(): Promise<IndexJob[]> {
  return transaction(async (db) => {
    if (!(await ensureSemanticStorageIn(db))) return [];
    const now = Date.now();
    await db.query("UPDATE semantic_evidence SET status='failed',lease=NULL,lease_until=0 WHERE status IN ('pending','retry') AND attempts>=$1 AND lease_until<=$2", [maxAttempts, now]);
    const rows = await db.query<Omit<IndexJob, 'lease'>>(
      'SELECT e.*,c.org_id FROM semantic_evidence e JOIN cases c ON c.id=e.case_id ' +
      "WHERE c.synthetic=0 AND c.deleted_at IS NULL AND c.archived=0 AND (c.record::jsonb->>'label')='private' " +
      "AND e.status IN ('pending','retry') AND e.attempts<$1 AND e.available_at<=$2 AND e.lease_until<=$2 AND e.model=$3 " +
      'ORDER BY e.available_at,e.case_id,e.kind,e.source_id LIMIT $4 FOR UPDATE OF e SKIP LOCKED',
      [maxAttempts, now, embeddingModel(), batchSize],
    );
    const jobs: IndexJob[] = [];
    for (const row of rows) {
      const lease = randomUUID();
      await db.query(
        'UPDATE semantic_evidence SET lease=$1,lease_until=$2,attempts=attempts+1 WHERE case_id=$3 AND kind=$4 AND source_id=$5',
        [lease, now + leaseMs, row.case_id, row.kind, row.source_id],
      );
      jobs.push({ ...row, lease, attempts: Number(row.attempts) + 1 });
    }
    return jobs;
  });
}

async function processJob(job: IndexJob, embed: (texts: string[]) => Promise<number[][]>) {
  const heartbeat = setInterval(() => {
    void transaction((db) => db.query(
      'UPDATE semantic_evidence SET lease_until=$1 WHERE case_id=$2 AND kind=$3 AND source_id=$4 AND lease=$5',
      [Date.now() + leaseMs, job.case_id, job.kind, job.source_id, job.lease],
    )).catch(() => undefined);
  }, leaseMs / 3);
  heartbeat.unref();
  try {
    const source = await transaction(async (db) => {
      const w = await workspaceIn(db, job.org_id, job.case_id);
      if (w.caseRecord.archived) return undefined;
      return semanticSources(w).find((s) => s.kind === job.kind && s.id === job.source_id && s.fingerprint === job.fingerprint);
    });
    if (!source) {
      await transaction((db) => db.query('DELETE FROM semantic_evidence WHERE case_id=$1 AND kind=$2 AND source_id=$3 AND lease=$4', [job.case_id, job.kind, job.source_id, job.lease]));
      return;
    }
    const vectors: number[][] = [];
    // Bound each external request, including imported unusually long records.
    for (let i = 0; i < source.chunks.length; i += 8) {
      const batch = await embed(source.chunks.slice(i, i + 8));
      if (batch.length !== Math.min(8, source.chunks.length - i)) throw new Error('Embedding count mismatch.');
      batch.forEach(vectorLiteral);
      vectors.push(...batch);
    }
    await transaction(async (db) => {
      // Lock the case before the queue row, matching workspace mutation order.
      const w = await workspaceIn(db, job.org_id, job.case_id);
      const current = !w.caseRecord.archived && semanticSources(w).some((s) => s.kind === job.kind && s.id === job.source_id && s.fingerprint === job.fingerprint);
      const [owned] = await db.query(
        'SELECT 1 FROM semantic_evidence WHERE case_id=$1 AND kind=$2 AND source_id=$3 AND fingerprint=$4 AND model=$5 AND lease=$6' + db.forUpdate,
        [job.case_id, job.kind, job.source_id, job.fingerprint, job.model, job.lease],
      );
      if (!owned) return;
      if (!current) {
        await db.query('DELETE FROM semantic_evidence WHERE case_id=$1 AND kind=$2 AND source_id=$3', [job.case_id, job.kind, job.source_id]);
        return;
      }
      await db.query('DELETE FROM semantic_vectors WHERE case_id=$1 AND kind=$2 AND source_id=$3', [job.case_id, job.kind, job.source_id]);
      const schema = await vectorSchema(db);
      for (const [chunk, vector] of vectors.entries()) await db.query(
        'INSERT INTO semantic_vectors(case_id,kind,source_id,chunk,fingerprint,model,embedding' + (schema ? ',embedding_vector' : '') + ') ' +
        'VALUES($1,$2,$3,$4,$5,$6,$7::real[]' + (schema ? ',$7::real[]::' + quote(schema) + '.vector' : '') + ')',
        [job.case_id, job.kind, job.source_id, chunk, job.fingerprint, job.model, '{' + vector.join(',') + '}'],
      );
      await db.query(
        "UPDATE semantic_evidence SET status='ready',lease=NULL,lease_until=0,updated_at=$1 WHERE case_id=$2 AND kind=$3 AND source_id=$4 AND lease=$5",
        [Date.now(), job.case_id, job.kind, job.source_id, job.lease],
      );
    });
  } catch {
    await transaction((db) => db.query(
      'UPDATE semantic_evidence SET status=$1,available_at=$2,lease=NULL,lease_until=0,updated_at=$3 WHERE case_id=$4 AND kind=$5 AND source_id=$6 AND lease=$7',
      [job.attempts >= maxAttempts ? 'failed' : 'retry', Date.now() + 1000 * 2 ** job.attempts, Date.now(), job.case_id, job.kind, job.source_id, job.lease],
    ));
  } finally {
    clearInterval(heartbeat);
  }
}

/** A bounded maintenance pass. Never called for SQLite or an unconfigured provider. */
export async function runSemanticIndexBatch(options: { embed?: (texts: string[]) => Promise<number[][]> } = {}) {
  if (!process.env.DATABASE_URL || !embeddingsConfigured()) return 0;
  await reconcileCases();
  const jobs = await claimJobs();
  // Keep request pressure bounded and avoid sending unrelated cases in one embedding request.
  await Promise.all(jobs.map((job) => processJob(job, options.embed ?? embedEvidence)));
  return jobs.length;
}
