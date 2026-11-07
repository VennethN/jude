<script lang="ts">
  import { page } from '$app/state';
  import { goto, invalidate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { ArrowLeft, BookOpen, BriefcaseBusiness, CalendarDays, ChevronRight, Compass, FileText, FolderOpen, GitFork, ListChecks, LogOut, MessageSquareText, PanelLeftClose, Search as Lens, Settings2, X } from '@lucide/svelte';
  import type { ContextRef, Preferences, Workspace } from '@jude/core/domain';
  import { api, write } from '$lib/client';
  import { initials } from '$lib/workspace/format';
  import Dialog from '$lib/workspace/Dialog.svelte';
  import Search from '$lib/workspace/Search.svelte';
  import Tours from '$lib/workspace/Tours.svelte';
  import Assistant from '$lib/evidence/Assistant.svelte';
  let { data, children }=$props();
  const w=$derived(page.data.workspace as Workspace|undefined), en=$derived(data.lang==='en'), account=$derived(data.account);
  const base=$derived(w?'/case/'+w.caseRecord.id:'');
  const prefs=$derived(account.prefs), section=$derived(page.url.pathname.split('/')[3]??'');
  const nav=$derived([
    {path:'',name:en?'Overview':'Ringkasan',icon:BookOpen},
    {path:'hearings',name:en?'Hearings':'Sidang',icon:CalendarDays},
    {path:'documents',name:en?'Documents':'Dokumen',icon:FolderOpen},
    {path:'findings',name:en?'Findings':'Temuan',icon:ListChecks},
    {path:'connections',name:en?'Connections':'Keterkaitan',icon:GitFork}
  ]);
  const live=$derived(w?.hearings.find(h=>h.mode==='live')), active=$derived(nav.find(n=>n.path===section)?.name??(en?'Assistant':'Asisten'));
  const context=$derived.by(():ContextRef=>{
    const parts=page.url.pathname.split('/'), id=parts[4];
    if(section==='documents'&&id)return page.url.searchParams.get('p')?{kind:'passage',id:page.url.searchParams.get('p')!}:{kind:'document',id};
    if(section==='hearings'&&id)return {kind:'hearing',id};
    if(section==='findings'&&id)return {kind:'finding',id};
    if(section==='findings'&&page.url.searchParams.get('view')==='board'&&w?.boards.length)return {kind:'board',id:page.url.searchParams.get('board')??w.boards[0].id};
    return section==='documents'?{kind:'documents'}:{kind:'case'};
  });
  let overlay=$state<'prefs'|'search'|'assistant'|'tour'|null>(null), systemDark=$state(false), errorMsg=$state('');
  const theme=$derived(prefs.theme==='system'?(systemDark?'night':'paper'):prefs.theme??'paper');
  onMount(()=>{const m=matchMedia('(prefers-color-scheme: dark)');const sync=()=>systemDark=m.matches;sync();m.addEventListener('change',sync);return()=>m.removeEventListener('change',sync)});
  $effect(()=>{const id=w?.caseRecord.id;if(!id)return;const stream=new EventSource('/api/cases/'+id+'/events');
    const refresh=(e:MessageEvent)=>{try{const msg=JSON.parse(e.data);const version=msg.version??msg.data?.version;if(typeof version==='number'&&version!==page.data.workspace?.version)void invalidate('jude:case')}catch{}};
    stream.onmessage=refresh;stream.addEventListener('case.updated',refresh);return()=>stream.close()});
  async function save(options:Preferences){try{await write('/api/me/prefs','PATCH',options);errorMsg=''}catch{errorMsg=en?'Could not save preferences.':'Preferensi belum tersimpan.'}}
  async function logout(){try{await api('/api/auth/logout','POST');location.assign('/')}catch{errorMsg=en?'Could not sign out.':'Belum dapat keluar.'}}
  function keys(e:KeyboardEvent){if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||/input|textarea|select/i.test((e.target as HTMLElement)?.tagName)||(e.target as HTMLElement)?.isContentEditable)return;if(e.key==='/'&&w&&!overlay){e.preventDefault();overlay='search'}else if(e.key==='Escape'&&overlay==='assistant'){overlay=null}}
</script>
<svelte:window onkeydown={keys}/>
<div class="desk" class:collapsed={prefs.railCollapsed} data-theme={theme} data-density={prefs.density??'comfortable'}>
  <a class="skip" href="#case-main">{en?'Skip to content':'Ke isi utama'}</a>
  <aside class="rail">
    <a class="brand" href="/cases" aria-label="Jude"><span class="full-brand">Jude</span><span class="mini-brand">J</span></a>
    <a class="rail-link cases-link" aria-current={!w?'page':undefined} href="/cases"><BriefcaseBusiness size={20}/><span>{en?'My cases':'Daftar perkara'}</span></a>
    {#if w}<div class="rail-divider"></div><p class="rail-ref">{w.caseRecord.reference||w.caseRecord.title}</p>
    <nav aria-label={en?'Case sections':'Bagian perkara'}>{#each nav as n}<a class="rail-link" href={base+(n.path?'/'+n.path:'')} aria-label={n.name} aria-current={section===n.path?'page':undefined}><n.icon size={19}/><span>{n.name}</span></a>{/each}</nav>
    <button class="rail-link assistant-link" onclick={()=>overlay='assistant'}><MessageSquareText size={19}/><span>{en?'Case assistant':'Asisten perkara'}</span></button>{/if}
    <div class="rail-foot"><a class="rail-link" href="/billing"><FileText size={18}/><span>{en?'Plan and usage':'Paket dan pemakaian'}</span></a>
    <button class="member" onclick={()=>overlay='prefs'}><span class="avatar">{initials(account.user.name)}</span><span class="account-label"><strong>{account.user.name}</strong><small>{account.user.guest?(en?'Guest workspace':'Ruang tamu'):account.organization.name}</small></span></button></div>
  </aside>
  <div class="work">
    <header class="topbar"><div class="crumb"><button class="rail-toggle" aria-label={en?'Toggle sidebar':'Alihkan bilah samping'} onclick={()=>save({railCollapsed:!prefs.railCollapsed})}><PanelLeftClose size={18}/></button><a class="mini-home" href="/cases" aria-label={en?'Cases':'Perkara'}><BriefcaseBusiness size={18}/></a><a class="crumb-home" href="/cases">{en?'Cases':'Perkara'}</a>{#if w}<ChevronRight size={14}/><span>{active}</span>{/if}</div>
    <div class="tools">{#if w}<button aria-label={en?'Search the case':'Cari dalam perkara'} onclick={()=>overlay='search'}><Lens size={18}/><span>{en?'Search':'Cari'}</span><kbd>/</kbd></button>{/if}{#if account.demo}<button aria-label={en?'Guided tours':'Panduan perkara'} onclick={()=>overlay='tour'}><Compass size={18}/></button>{/if}<button aria-label={en?'Preferences':'Preferensi'} onclick={()=>overlay='prefs'}><Settings2 size={18}/></button></div></header>
    <main id="case-main" tabindex="-1" class="content">{@render children()}</main>
    {#if w&&live&&section!=='hearings'}<a class="live-tab" href={base+'/hearings/'+live.id}><span></span>{w.caseRecord.label==='synthetic'?(en?'Example hearing':'Sidang contoh'):(en?'Hearing in progress':'Sidang berlangsung')}<ChevronRight size={15}/></a>{/if}
  </div>
  {#if w}<nav class="phone-nav" aria-label={en?'Case navigation':'Navigasi perkara'}>{#each nav as n}<a href={base+(n.path?'/'+n.path:'')} aria-current={section===n.path?'page':undefined}><n.icon size={19}/><span>{n.name}</span></a>{/each}</nav>{/if}
  {#if overlay==='search'&&w}<Search workspace={w} lang={data.lang} close={()=>overlay=null}/>{/if}
  {#if overlay==='tour'&&account.demo}<Tours session={account} lang={data.lang} close={()=>overlay=null}/>{/if}
  {#if overlay==='assistant'&&w}<Dialog title={en?'Case assistant':'Asisten perkara'} lang={data.lang} close={()=>overlay=null} wide><Assistant workspace={w} lang={data.lang} compact {context}/><a class="button" href={base+'/assistant'} onclick={()=>overlay=null}>{en?'All conversations':'Semua percakapan'}</a></Dialog>{/if}
  {#if overlay==='prefs'}<Dialog title={en?'Preferences':'Preferensi'} lang={data.lang} close={()=>overlay=null}>
    <div class="stack"><form method="POST" action="/language" class="field"><label for="ui-language">{en?'Interface language':'Bahasa antarmuka'}</label><input type="hidden" name="next" value={page.url.pathname+page.url.search}/><select id="ui-language" name="lang" value={data.lang} onchange={(e)=>e.currentTarget.form?.requestSubmit()}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></form>
      <label class="field">{en?'Appearance':'Tampilan'}<select value={prefs.theme??'paper'} onchange={e=>save({theme:e.currentTarget.value as Preferences['theme']})}><option value="paper">{en?'Paper':'Kertas'}</option><option value="night">{en?'Night':'Malam'}</option><option value="system">{en?'Device setting':'Ikuti perangkat'}</option></select></label>
      <label class="field">{en?'Row spacing':'Jarak baris'}<select value={prefs.density??'comfortable'} onchange={e=>save({density:e.currentTarget.value as Preferences['density']})}><option value="comfortable">{en?'Comfortable':'Lapang'}</option><option value="compact">{en?'Compact':'Rapat'}</option></select></label>
      {#if errorMsg}<p class="error-text" role="alert">{errorMsg}</p>{/if}<div class="actions"><a class="button" href="/billing">{en?'Plan and usage':'Paket dan pemakaian'}</a><button class="button" onclick={logout}><LogOut size={16}/>{en?'Sign out':'Keluar'}</button></div></div>
  </Dialog>{/if}
</div>
<style>
 .desk{--rail-width:232px;min-height:100dvh;background:var(--paper);color:var(--ink)}.desk.collapsed{--rail-width:78px}
 .skip{position:fixed;top:-80px;left:20px;z-index:10;background:var(--surface);padding:12px}.skip:focus{top:8px}
 .rail{position:fixed;inset:0 auto 0 0;width:var(--rail-width);background:#193c31;color:#eff1df;padding:28px 16px 14px;display:flex;flex-direction:column;z-index:3;overflow-y:auto}.rail .brand{color:#f6f1dd;padding-left:13px;font-size:46px;margin:8px 0 38px}.mini-brand{display:none}
 .rail nav{display:grid;gap:3px}.rail-link,.member{display:flex;align-items:center;gap:12px;text-align:left;min-height:45px;padding:9px 12px;text-decoration:none;color:#dce5d7;background:transparent;border:0;border-radius:7px;font-size:.91rem;font-weight:500;width:100%}.rail-link:hover,.member:hover{background:#274a3d}.rail-link[aria-current=page]{background:#345545;color:#fff9e8}.rail-link :global(svg){flex-shrink:0}
 .rail-divider{margin:20px 10px 16px;border-top:1px solid #456052}.rail-ref{color:#c4cfbc;font-size:.75rem;margin:1px 12px 10px;overflow-wrap:anywhere}.rail-foot{margin-top:auto;padding-top:35px}.member{border-top:1px solid #476052;border-radius:0;padding-top:15px;margin-top:8px}.avatar{display:grid;place-items:center;background:#cad5bb;color:#2a4434;width:36px;height:36px;border-radius:50%;flex-shrink:0}.account-label{min-width:0}.member small,.member strong{display:block;overflow:hidden;text-overflow:ellipsis;font-size:.84rem}.member small{color:#c7d3c3;font-size:.72rem}.assistant-link{margin-top:20px}
 .work{margin-left:var(--rail-width);min-width:0}.topbar{display:flex;align-items:center;justify-content:space-between;min-height:62px;padding:4px var(--gutter);gap:6px;border-bottom:1px solid var(--line);background:var(--surface)}.crumb,.tools{display:flex;gap:8px;align-items:center}.crumb{font-size:.84rem;color:var(--muted)}.crumb a{text-decoration:none}.tools button,.rail-toggle,.mini-home{display:inline-flex;align-items:center;justify-content:center;gap:8px;color:var(--muted);background:transparent;border:0;min-height:44px;min-width:44px;border-radius:6px}.tools button:hover,.rail-toggle:hover{background:var(--wash)}.tools kbd{padding:0 5px;border:1px solid var(--line);border-radius:4px}.content{margin:0 auto;max-width:1520px;padding:clamp(26px,4vw,60px) var(--gutter) 95px;min-width:0;outline:none}
 .live-tab{position:fixed;bottom:15px;left:calc(var(--rail-width) + 16px);background:var(--forest);color:var(--on-forest);z-index:2;min-height:44px;display:flex;gap:9px;align-items:center;padding:8px 14px;border-radius:24px;text-decoration:none;font-size:.82rem}.live-tab>span{width:7px;height:7px;border-radius:50%;background:#e8b29b}.phone-nav,.mini-home{display:none}
 .collapsed .rail-link span,.collapsed .account-label,.collapsed .rail-ref,.collapsed .full-brand{display:none}.collapsed .mini-brand{display:block}.collapsed .rail .brand{padding-left:10px}.collapsed .member{padding-left:5px}
 @media(min-width:761px) and (max-width:1060px){.desk{--rail-width:78px}.rail-link span,.account-label,.rail-ref,.full-brand{display:none}.mini-brand{display:block}.rail .brand{padding-left:10px}.member{padding-left:5px}.rail-toggle{display:none}}
 @media(max-width:760px){.desk,.desk.collapsed{--rail-width:0px}.rail,.rail-toggle,.crumb-home,.tools button>span,.tools kbd{display:none}.topbar{min-height:50px}.mini-home{display:flex}.content{padding-bottom:90px}.phone-nav{position:fixed;inset:auto 0 0;z-index:4;display:flex;justify-content:space-around;background:var(--surface);border-top:1px solid var(--line);padding:4px 2px max(4px,env(safe-area-inset-bottom))}.phone-nav a{display:grid;justify-items:center;align-content:center;gap:3px;min-height:52px;flex:1;font-size:.68rem;text-decoration:none;color:var(--muted)}.phone-nav a[aria-current=page]{font-weight:700;color:var(--ink);background:var(--wash);border-radius:6px}.live-tab{position:static;justify-content:center;margin:0 16px 76px}.tools{gap:1px}}
</style>
