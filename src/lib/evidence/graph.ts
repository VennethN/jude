import type { Lang, Relation, Status, Workspace } from '$lib/domain';
import { evidenceKey, sourceOf, type Source } from './records';

export type Kind = 'statement' | 'finding' | 'passage';
export type EvidenceRef = {kind:Kind;id:string};
export interface Pairing { key:string; from:string; to:string; relation:Relation; reviewed:boolean; connectionId?:string; findingId?:string }
export interface MapNode { ref:EvidenceRef; source:Source; column:string; key:string }
export const statusRelation:Record<Status,Relation> = {
  potential_inconsistency:'conflicts',context_needed:'context',supported:'supports',insufficient_evidence:'related'
};

export function graphOf(w:Workspace,lang:Lang) {
  const nodes:MapNode[]=[];
  function append(ref:EvidenceRef,column:string){
    const source=sourceOf(w,ref,lang);
    if(source)nodes.push({ref,source,column,key:evidenceKey(ref)});
  }
  for(const s of w.statements)append({kind:'statement',id:s.id},'hearing:'+s.hearingId);
  for(const f of w.findings)append({kind:'finding',id:f.id},'findings');
  for(const p of w.passages)append({kind:'passage',id:p.id},'document:'+p.docId);
  const pairs:Pairing[]=[],seen=new Set<string>();
  const vertices=new Map(nodes.map(n=>[n.key,n]));
  function connect(pair:Pairing){
    const key=[pair.from,pair.to].sort().join('|');
    if(seen.has(key)||!vertices.has(pair.from)||!vertices.has(pair.to))return;
    seen.add(key);pairs.push(pair);
  }
  for(const c of w.connections)connect({key:c.id,from:evidenceKey(c.from),to:evidenceKey(c.to),relation:c.relation,reviewed:c.reviewed,connectionId:c.id});
  for(const f of w.findings){
    const from='statement:'+f.statementId;
    connect({key:f.id+':about',from,to:'finding:'+f.id,relation:statusRelation[f.status],reviewed:f.reviewed,findingId:f.id});
    for(const s of f.sources)connect({key:f.id+':'+s.passageId,from,to:'passage:'+s.passageId,relation:s.relation,reviewed:f.reviewed,findingId:f.id});
  }
  const adjacent=new Map<string,Set<string>>();
  for(const p of pairs){
    if(!adjacent.has(p.from))adjacent.set(p.from,new Set());
    if(!adjacent.has(p.to))adjacent.set(p.to,new Set());
    adjacent.get(p.from)!.add(p.to);adjacent.get(p.to)!.add(p.from);
  }
  return {nodes,vertices,pairs,adjacent};
}

export function groupOf(keys:string[],adjacent:Map<string,Set<string>>) {
  const visited=new Set(keys),queue=[...keys];
  for(let i=0;i<queue.length;i++){
    for(const next of adjacent.get(queue[i])??[]){
      if(!visited.has(next)){visited.add(next);queue.push(next);}
    }
  }
  return visited;
}

export interface Pose {x:number;y:number;w:number;h:number}
export function place(nodes:MapNode[],members:Set<string>,group:boolean,adjacent:Map<string,Set<string>>){
  const positions:Record<string,Pose>={}, columns:{key:string;x:number;w:number;count:number}[]=[];
  const byColumn=new Map<string,MapNode[]>();
  const order:Kind[]=['statement','finding','passage'];
  for(const node of nodes){
    if(group&&!members.has(node.key))continue;
    const column=group?node.ref.kind:node.column;
    if(!byColumn.has(column))byColumn.set(column,[]);
    byColumn.get(column)!.push(node);
  }
  const entries=[...byColumn];
  if(group)entries.sort(([a],[b])=>order.indexOf(a as Kind)-order.indexOf(b as Kind));
  let x=34, height=200;
  for(const [column,items] of entries){
    const hasPairs=items.some(n=>adjacent.has(n.key));
    const w=group?204:hasPairs?170:100;
    let y=62;columns.push({key:column,x,w,count:items.length});
    for(const node of items){
      const h=group?86:adjacent.has(node.key)?70:38;
      positions[node.key]={x,y,w,h};y+=h+14;
    }
    height=Math.max(height,y+28);x+=w+(group?82:56);
  }
  return {positions,columns,width:Math.max(320,x),height};
}

export function connector(a:Pose,b:Pose,index:number){
  const ya=a.y+a.h/2,yb=b.y+b.h/2;
  if(a.x===b.x){
    const lane=Math.max(8,a.x-15-index%3*4);
    return 'M'+a.x+' '+ya+' C'+lane+' '+ya+' '+lane+' '+yb+' '+b.x+' '+yb;
  }
  const [left,right]=a.x<=b.x?[a,b]:[b,a];
  const x1=left.x+left.w,x2=right.x;
  const y1=left.y+left.h/2,y2=right.y+right.h/2;
  const dx=(x2-x1)/2;
  if(x2-x1>160){
    const track=40-index%5*5, before=x1+18+index%3*4, after=x2-18-index%3*4;
    return 'M'+x1+' '+y1+' H'+before+' V'+track+' H'+after+' V'+y2+' H'+x2;
  }
  return 'M'+x1+' '+y1+' C'+(x1+dx)+' '+y1+' '+(x2-dx)+' '+y2+' '+x2+' '+y2;
}

