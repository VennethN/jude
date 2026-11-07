import { randomUUID } from 'node:crypto';
import { readWorkspace, mutateWorkspace, workspaceIn } from './cases';
import { transaction } from './db';
import { analysisEligibleCase, queueStatementIn, recoverStatements } from './queue';
import { purgeExpired } from './retention';
import { runSemanticIndexBatch } from './semantic-index';

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
        'WHERE j.available_at<=$1 AND j.lease_until<=$1 AND ' + analysisEligibleCase + ' ORDER BY j.available_at,j.statement_id LIMIT 1' +
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
      const { analyzeSaved } = await import('./providers/save-analysis');
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
    recovering = false,
    lastRecovery = 0,
    lastPurge = 0,
    purging = false;
  let indexing = false;
  const maintainRetention = async () => {
    if (purging || stopped || Date.now() - lastPurge < 60 * 60_000) return;
    purging = true;
    try {
      const result = await purgeExpired();
      // Drain any backlog in bounded batches; idle installations check hourly.
      if (result.cases < 32 && result.records < 64 && result.objects < 64) lastPurge = Date.now();
    } catch {
      // The next check resumes from the durable object queue.
    } finally {
      purging = false;
    }
  };
  const lanes = new Set<number>();
  async function runLane(lane: number) {
    if (stopped || lanes.has(lane)) return;
    lanes.add(lane);
    try {
      while (!stopped) {
        const job = await claim();
        if (!job) return;
        await processOne(job);
      }
    } catch {
      // An expired lease or a transient database failure is retried on the next poll.
    } finally { lanes.delete(lane); }
  }
  const tick = () => {
    if (stopped) return;
    void maintainRetention();
    if (!indexing) {
      indexing = true;
      void runSemanticIndexBatch().catch(() => undefined).finally(() => { indexing = false; });
    }
    if (!recovering && Date.now() - lastRecovery > 60_000) {
      recovering = true;
      void transaction(recoverStatements)
        .then(() => { lastRecovery = Date.now(); })
        .catch(() => undefined)
        .finally(() => { recovering = false; });
    }
    // An idle lane must keep accepting new testimony while its neighbour awaits a model result.
    void runLane(0);
    void runLane(1);
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
