<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { ArrowLeft, ArrowRight, Check, Compass, X } from '@lucide/svelte';
  import type { SessionInfo, Lang } from '@jude/core/domain';
  import { api } from '$lib/client';
  import Dialog from './Dialog.svelte';
  let {session,lang,close,startOverview=false}:{session:SessionInfo;lang:Lang;close:()=>void;startOverview?:boolean}=$props();
  const en=$derived(lang==='en');
  const tours=[
    {key:'overview',name:['Mengenal perkara','Explore a case'],steps:[['','Buka berkas perkara dan baca ringkasannya.','Open the case file and read its summary.'],['/hearings','Telusuri sidang yang membentuk perkara.','Browse the hearings in this case.'],['/findings','Tinjau perbandingan yang memerlukan perhatian.','Review the comparisons that need attention.']]},
    {key:'hearing',name:['Mengikuti sidang','Follow a hearing'],steps:[['/hearings','Pilih sidang dari daftar.','Choose a hearing from the library.'],['/hearings/h3','Ikuti transkrip contoh. Klik penanda buku untuk menyimpan ucapan.','Follow the example transcript. Bookmark a line to keep it.'],['/findings?tab=saved','Baca kembali ucapan yang ditandai.','Revisit the bookmarked lines.']]},
    {key:'findings',name:['Menelaah temuan','Review findings'],steps:[['/findings','Pilih temuan yang perlu diperiksa.','Choose a finding that needs review.'],['/findings/f1','Bandingkan kedua frasa dan buka sumbernya.','Compare the two phrases and open their source.']]},
    {key:'documents',name:['Membaca dokumen','Read the original'],steps:[['/documents','Pilih dokumen dari daftar.','Choose an exhibit from the register.'],['/documents/d1?p=d1p4','Kutipan membuka halaman yang dirujuk.','The cited passage opens its page.']]},
    {key:'connections',name:['Menelusuri keterkaitan','Explore connections'],steps:[['/connections','Pilih bukti untuk melihat kelompoknya.','Choose evidence to inspect its group.'],['/connections?of=statement:s208','Periksa kaitan pernyataan dengan catatan.','Inspect how this statement relates to the record.']]},
    {key:'board',name:['Menyusun papan','Arrange a board'],steps:[['/findings?view=board','Susun kartu bukti di papan.','Arrange evidence cards on the board.'],['/assistant','Ajukan pertanyaan dengan bukti sebagai konteks.','Ask a question with evidence as context.']]}
  ];
  let active=$state(-1), step=$state(0), feedback=$state('');
  onMount(() => {
    if (startOverview) {
      void go(0, 0);
      return;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem('jude-tour:' + session.user.id) ?? 'null');
      if (saved && Number.isInteger(saved.active) && Number.isInteger(saved.step) && tours[saved.active]?.steps[saved.step]) {
        active = saved.active;
        step = saved.step;
      }
    } catch { /* A stale preference can be replaced by a new tour. */ }
  });
  async function go(index:number, n:number){
    if(!session.demo)return;
    active=index;step=n;sessionStorage.setItem('jude-tour:'+session.user.id,JSON.stringify({active,step}));
    const href='/case/'+session.demo.caseId+tours[index].steps[n][0];
    if (page.url.pathname + page.url.search !== href) await goto(href,{keepFocus:true});
  }
  async function next(){if(step+1<tours[active].steps.length){await go(active,step+1);return}
    try{await api('/api/me/prefs','PATCH',{tourSeen:true,toursDone:[...new Set([...(session.prefs.toursDone??[]),tours[active].key])]});sessionStorage.removeItem('jude-tour:'+session.user.id);active=-1;await invalidateAll()}catch{feedback=en?'Could not save tour progress.':'Progres tur belum tersimpan.'}}
  function keys(e:KeyboardEvent){if(active<0||/input|textarea/i.test((e.target as HTMLElement)?.tagName))return;if(e.key==='Escape')close();if(e.key==='ArrowRight'){e.preventDefault();void next()}if(e.key==='ArrowLeft'&&step){e.preventDefault();void go(active,step-1)}}
</script>
<svelte:window onkeydown={keys}/>
{#if active<0}
  <Dialog title={en?'Guided tours':'Panduan perkara'} {lang} {close}>
    <div class="tour-list">{#each tours as t,i}<button onclick={()=>go(i,0)}><Compass size={18}/><span>{t.name[en?1:0]}</span>{#if session.prefs.toursDone?.includes(t.key)}<Check size={17}/>{:else}<ArrowRight size={17}/>{/if}</button>{/each}</div>
  </Dialog>
{:else}
 <aside class="tour-strip" aria-live="polite"><div><b>{tours[active].name[en?1:0]} · {step+1}/{tours[active].steps.length}</b><p>{tours[active].steps[step][en?2:1]}</p>{#if feedback}<p>{feedback}</p>{/if}</div>
 <div class="actions"><button class="icon-button" aria-label={en?'Previous step':'Sebelumnya'} disabled={step===0} onclick={()=>go(active,step-1)}><ArrowLeft size={18}/></button><button class="button primary" onclick={next}>{step+1===tours[active].steps.length?(en?'Finish':'Selesai'):(en?'Next':'Lanjut')}</button><button class="icon-button" onclick={close} aria-label={en?'Pause tour':'Jeda tur'}><X size={18}/></button></div></aside>
{/if}
<style>.tour-list{display:grid}.tour-list button{display:flex;gap:12px;align-items:center;color:var(--ink);background:transparent;border:0;border-bottom:1px solid var(--line);min-height:52px;text-align:left}.tour-list span{flex:1}.tour-strip{position:fixed;z-index:75;right:18px;bottom:18px;max-width:390px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;display:grid;gap:10px}.tour-strip p{font-size:.92rem}.tour-strip b{font-size:.8rem}@media(max-width:760px){.tour-strip{bottom:calc(78px + env(safe-area-inset-bottom, 0px));left:12px;right:12px}:global(.desk.has-live) .tour-strip{bottom:calc(124px + env(safe-area-inset-bottom, 0px))}}</style>
