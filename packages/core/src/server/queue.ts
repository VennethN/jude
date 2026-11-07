import type { Database } from './db';

const eligible =
  'c.synthetic=0 AND c.deleted_at IS NULL AND c.archived=0 AND EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=c.org_id AND u.guest=0)';
export async function queueStatementIn(db: Database, caseId: string, statementId: string) {
  await db.query(
    'INSERT INTO analysis_jobs(case_id,statement_id,available_at) SELECT c.id,$2,$3 FROM cases c WHERE c.id=$1 AND ' +
      eligible +
      ' ON CONFLICT(case_id,statement_id) DO NOTHING',
    [caseId, statementId, Date.now()],
  );
}
export async function recoverStatements(db: Database) {
  await db.query(
    'INSERT INTO analysis_jobs(case_id,statement_id,available_at) SELECT c.id,e.id,$1 FROM cases c JOIN case_entities e ON e.case_id=c.id WHERE ' +
      eligible +
      " AND e.kind='statements' AND e.body LIKE $2 AND NOT EXISTS (SELECT 1 FROM analysis_jobs j WHERE j.case_id=c.id AND j.statement_id=e.id) ON CONFLICT(case_id,statement_id) DO NOTHING",
    [Date.now(), '%"phase":"queued"%'],
  );
}
