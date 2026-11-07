import { plans, type PlanId, type QuotaId } from '../public/plans';
import type { SessionInfo } from '../domain';
import { orgLock } from './cases';
import type { Database } from './db';
import { ApiError, choice, missing, unavailable, type Fields } from './validation';

const period = () => new Date().toISOString().slice(0,7);
export async function meter(db:Database,orgId:string,quota:'hours'|'questions',amount:number) {
  await db.query('INSERT INTO usage_counts(org_id,period,quota,amount) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,period,quota) DO UPDATE SET amount=usage_counts.amount+excluded.amount',[orgId,period(),quota,amount]);
}
export async function billing(db:Database,orgId:string) {
  const [org]=await db.query<{plan_id:PlanId;cycle:'monthly'|'yearly';plan_status:string;trial_ends:number|string|null;trial_used:number}>('SELECT plan_id,cycle,plan_status,trial_ends,trial_used FROM organizations WHERE id=$1',[orgId]);
  if (!org) missing();
  const expired=org.plan_status==='trialing' && Number(org.trial_ends)<=Date.now();
  const planId:PlanId=expired?'basic':org.plan_id;
  const plan=plans.find(p=>p.id===planId)!;
  const figures=await db.query<{quota:QuotaId;used:number|string}>(
    "SELECT 'boards' AS quota, COUNT(*) AS used FROM cases c JOIN case_entities e ON e.case_id=c.id WHERE c.org_id=$1 AND c.deleted_at IS NULL AND e.kind='boards' "+
    "UNION ALL SELECT 'cases',COUNT(*) FROM cases WHERE org_id=$1 AND archived=0 AND deleted_at IS NULL AND synthetic=0 "+
    "UNION ALL SELECT 'seats',COUNT(*) FROM memberships WHERE org_id=$1 "+
    "UNION ALL SELECT 'storage',COALESCE(SUM(byte_length),0) FROM attachments a JOIN cases c ON c.id=a.case_id WHERE c.org_id=$1 AND c.deleted_at IS NULL "+
    "UNION ALL SELECT quota,amount FROM usage_counts WHERE org_id=$1 AND period=$2",[orgId,period()]);
  const usage={} as Record<QuotaId,{used:number;limit:number|null}>;
  for (const id of Object.keys(plan.quotas) as QuotaId[]) {
    const current=Number(figures.find(f=>f.quota===id)?.used ?? 0);
    usage[id]={used:id==='storage'?current/1e9:id==='hours'?current/3600:current,limit:plan.quotas[id]};
  }
  return {planId,cycle:org.cycle,status:expired?'active':org.plan_status,trialEndsAt:org.trial_ends?new Date(Number(org.trial_ends)).toISOString():null,
    trialUsed:Boolean(org.trial_used),usage,plans};
}
export async function checkQuota(db:Database,orgId:string,quota:QuotaId,adding:number) {
  await orgLock(db,orgId);
  const account=await billing(db,orgId);
  const {used,limit}=account.usage[quota];
  if (limit!==null && used+adding>limit) throw new ApiError(402,'quota_exceeded','Your plan limit has been reached.',{plan:account.planId,quota,used,limit});
  return account;
}
export async function applyPlan(db:Database,session:SessionInfo,fields:Fields) {
  const org=session.organization.id;
  if (session.role!=='owner') throw new ApiError(403,'forbidden','The account owner manages billing.');
  const next=choice(fields.planId,['basic','pro','firm'],'planId');
  const cycle=choice(fields.cycle ?? 'monthly',['monthly','yearly'],'cycle');
  await orgLock(db,org);
  const current=await billing(db,org);
  if (current.planId===next && current.cycle===cycle) return current;
  if (next!=='basic' && !session.user.guest && current.trialUsed) unavailable('billing');
  const trial=next!=='basic' && !session.user.guest;
  await db.query('UPDATE organizations SET plan_id=$1,cycle=$2,plan_status=$3,trial_ends=$4,trial_used=$5 WHERE id=$6',
    [next,cycle,trial?'trialing':'active',trial?Date.now()+14*86400000:null,Number(trial||current.trialUsed),org]);
  return billing(db,org);
}

