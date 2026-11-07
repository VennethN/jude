import type { ContextRef, Lang, Workspace } from '../../domain';
import type { Source } from './assistant';
import { sourceKey } from './semantic-retrieval';

export function isCaseSummary(question: string, contexts: ContextRef[]) {
  if (contexts.length && !contexts.some(ref => ref.kind === 'case')) return false;
  const text = question.toLowerCase().trim();
  const summary = /\b(summari[sz]e|summary|overview|recap|briefing|ringkas\w*|rangkum\w*|ikhtisar|gambaran)\b/u;
  return summary.test(text) && (/\b(case|matter|file|record|perkara|kasus|berkas)\b/u.test(text) ||
    /^(give me an overview|recap|summari[sz]e|ringkas|rangkum)[.!?]?$/u.test(text));
}

/** Broad questions need a cross-section of the record even when their wording matches no testimony. */
export function summaryEvidence(w: Workspace, all: Source[], lang: Lang) {
  const byId = new Map(all.map(source => [sourceKey(source), source]));
  const priority = { potential_inconsistency:0, context_needed:1, insufficient_evidence:2, supported:3 };
  const issues = [...w.findings].sort((a,b) => priority[a.status] - priority[b.status]).map(f => ({
    status:f.status, title:f.title[lang],
    sources:[{kind:'statement',id:f.statementId}, ...f.sources.map(s=>({kind:'passage',id:s.passageId}))]
      .map(sourceKey).filter(id=>byId.has(id))
  }));
  const selected = new Map<string,Source>();
  function add(id: string) {
    const source = byId.get(id);
    if (source && selected.size < 32) selected.set(id,source);
  }
  // Give each material issue both sides before filling in the wider chronology.
  for (const issue of issues.slice(0,8)) for (const id of issue.sources.slice(0,3)) add(id);
  const groups = new Map<string,string[]>();
  function group(id:string, source:string) {
    const list = groups.get(id);
    if (list) list.push(source); else groups.set(id,[source]);
  }
  for (const p of w.passages) group('d:'+p.docId,'passage:'+p.id);
  for (const s of w.statements) group('h:'+s.hearingId,'statement:'+s.id);
  for (let depth=0; selected.size<32; depth++) {
    let any = false;
    for (const ids of groups.values()) if (depth < ids.length) { add(ids[depth]); any = true; }
    if (!any) break;
  }
  if (!selected.size) all.forEach(s=>add(sourceKey(s)));
  const numbered = new Map([...selected.keys()].map((id,i)=>[id,i+1]));
  return {
    sources:[...selected.values()],
    issues:issues.slice(0,8).map(issue=>({...issue,sources:issue.sources.flatMap(id=>numbered.has(id)?[numbered.get(id)!]:[])}))
      .filter(issue=>issue.sources.length)
  };
}
