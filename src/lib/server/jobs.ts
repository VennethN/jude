import { randomUUID } from 'node:crypto';
import { readWorkspace, mutateWorkspace, workspaceIn } from './cases';
import { transaction } from './db';
import { queueStatementIn, recoverStatements } from './queue';

interface Job {
  case_id: string;
  org_id: string;
  statement_id: string;
  attempts: number;
  lease: string;
}
const leaseMs = 90_000,
  maxAttempts = 4;
export async function enqueueAnalysis(org: string, caseId: string, lineId: string) {
  await transaction(async (db) => {
    const w = await workspaceIn(db, org, caseId);
    if (w.statements.some((line) => line.id === lineId && line.phase === 'queued'))
      await queueStatementIn(db, caseId, lineId);
  });
}
async function claim(): Promise<Job | null> {
  return transaction(async (db) => {
    const now = Date.now();
    const [next] = await db.query<Omit<Job, 'lease'>>(
      'SELECT j.case_id,c.org_id,j.statement_id,j.attempts FROM analysis_jobs j JOIN cases c ON c.id=j.case_id ' +
        'WHERE j.available_at<=$1 AND j.lease_until<=$1 AND c.deleted_at IS NULL AND c.archived=0 ORDER BY j.available_at,j.statement_id LIMIT 1' +
        (db.forUpdate ? ' FOR UPDATE OF j SKIP LOCKED' : ''),
      [now],
    );
    if (!next) return null;
    const lease = randomUUID();
    await db.query(
      'UPDATE analysis_jobs SET lease=$1,lease_until=$2,attempts=attempts+1 WHERE case_id=$3 AND statement_id=$4',
      [lease, now + leaseMs, next.case_id, next.statement_id],
    );
    return { ...next, lease, attempts: Number(next.attempts) + 1 };
  });
}
function finish(job: Job) {
  return transaction((db) =>
    db.query('DELETE FROM analysis_jobs WHERE case_id=$1 AND statement_id=$2 AND lease=$3', [
      job.case_id,
      job.statement_id,
      job.lease,
    ]),
  );
}
async function processOne(job: Job) {
  const heartbeat = setInterval(() => {
    void transaction((db) =>
      db.query('UPDATE analysis_jobs SET lease_until=$1 WHERE case_id=$2 AND statement_id=$3 AND lease=$4', [
        Date.now() + leaseMs,
        job.case_id,
        job.statement_id,
        job.lease,
      ]),
    ).catch(() => undefined);
  }, leaseMs / 3);
  heartbeat.unref();
  try {
    const w = await readWorkspace(job.org_id, job.case_id);
    const line = w.statements.find((s) => s.id === job.statement_id);
    if (line?.phase === 'queued' && w.caseRecord.label === 'private' && !w.caseRecord.archived) {
      const { analyzeSaved } = await import('./live/audio');
      await analyzeSaved(job.org_id, job.case_id, line);
    }
    await finish(job);
  } catch {
    if (job.attempts >= maxAttempts) {
      await mutateWorkspace(job.org_id, job.case_id, (w) => {
        const line = w.statements.find((s) => s.id === job.statement_id);
        if (line?.phase === 'queued') line.phase = 'saved';
      }).catch(() => undefined);
      await finish(job);
    } else {
      await transaction((db) =>
        db.query(
          'UPDATE analysis_jobs SET available_at=$1,lease=NULL,lease_until=0 WHERE case_id=$2 AND statement_id=$3 AND lease=$4',
          [Date.now() + 1000 * 2 ** job.attempts, job.case_id, job.statement_id, job.lease],
        ),
      );
    }
  } finally {
    clearInterval(heartbeat);
  }
}
let stopWorker: (() => void) | undefined;
export function runAnalysisWorker() {
  if (stopWorker) return stopWorker;
  let stopped = false,
    active = false,
    lastRecovery = 0;
  const tick = async () => {
    if (stopped || active) return;
    active = true;
    try {
      if (Date.now() - lastRecovery > 60_000) {
        await transaction(recoverStatements);
        lastRecovery = Date.now();
      }
      const lanes = async () => {
        while (!stopped) {
          const job = await claim();
          if (!job) return;
          await processOne(job);
        }
      };
      await Promise.allSettled([lanes(), lanes()]);
    } catch {
      /* Retry the database connection on the next tick. */
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 1200);
  timer.unref();
  void tick();
  stopWorker = () => {
    stopped = true;
    clearInterval(timer);
    stopWorker = undefined;
  };
  return stopWorker;
}
