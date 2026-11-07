<script lang="ts">
  import { goto } from '$app/navigation';
  import { Search as Lens } from '@lucide/svelte';
  import type { Workspace, Lang } from '$lib/domain';
  import { localized, displaySpeaker } from './format';
  import Dialog from './Dialog.svelte';
  let {workspace:w,lang,close}:{workspace:Workspace;lang:Lang;close:()=>void}=$props();
  let query=$state('');
  const en=$derived(lang==='en'), base=$derived('/case/'+w.caseRecord.id);
  const entries=$derived([
    ...w.hearings.map(h=>({kind:en?'Hearing':'Sidang',title:h.title[lang],text:h.title[lang],url:base+'/hearings/'+h.id})),
    ...w.documents.map(d=>({kind:en?'Document':'Dokumen',title:d.title,text:d.title,url:base+'/documents/'+d.id})),
    ...w.passages.map(p=>({kind:en?'Passage':'Kutipan',title:(w.documents.find(d=>d.id===p.docId)?.title??'')+' · '+(en?'p. ':'hlm. ')+p.page,text:p.text,url:base+'/documents/'+p.docId+'?p='+p.id})),
    ...w.statements.map(s=>({kind:en?'Testimony':'Kesaksian',title:displaySpeaker(w.speakers,s.speakerId,lang),text:s.text,url:base+'/hearings/'+s.hearingId+'?s='+s.id})),
    ...w.findings.map(f=>({kind:en?'Finding':'Temuan',title:f.title[lang],text:localized(f.explanation,lang),url:base+'/findings/'+f.id}))
  ]);
  const results=$derived(entries.filter(r=>(r.title+' '+r.text).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0,35));
</script>
<Dialog title={en?'Search the case file':'Cari dalam berkas perkara'} {lang} {close} wide>
  <label class="search-in"><Lens size={20}/><input aria-label={en?'Search terms':'Kata pencarian'} bind:value={query} placeholder={en?'A name, phrase, or document…':'Nama, frasa, atau dokumen…'}/></label>
  <div class="results">
    {#each results as r (r.url+'-'+r.kind)}<a href={r.url} onclick={(e)=>{e.preventDefault();close();void goto(r.url)}}><small>{r.kind}</small><b>{r.title}</b>{#if r.title!==r.text}<span>{r.text}</span>{/if}</a>{:else}<p>{en?'No matching records. Try a shorter phrase.':'Tidak ada catatan yang cocok. Coba frasa yang lebih pendek.'}</p>{/each}
  </div>
</Dialog>
<style>.search-in{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--ink);padding:8px}.search-in input{background:transparent;border:0;width:100%;min-height:40px}.results{max-height:55vh;overflow:auto;margin-top:12px}.results a{display:grid;gap:3px;border-bottom:1px solid var(--line);padding:12px 4px;text-decoration:none}.results a:hover{background:var(--wash)}.results small,.results span{color:var(--muted)}.results span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}</style>
