<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import type { CaseRecord, Lang } from '@jude/core/domain';
  import { api } from '$lib/client';
  import Dialog from './Dialog.svelte';
  let {record,lang,close}:{record?:CaseRecord;lang:Lang;close:()=>void}=$props();
  const en=$derived(lang==='en');
  let title=$state(''),reference=$state(''),court=$state(''),client=$state(''),summary=$state(''),busy=$state(false),message=$state('');
  $effect(()=>{if(record){title=record.title;reference=record.reference;court=record.court;client=record.client;summary=record.summary[lang]}});
  async function submit(e:SubmitEvent){e.preventDefault();if(busy)return;busy=true;message='';try{
    const item=await api<CaseRecord>(record?'/api/cases/'+record.id:'/api/cases',record?'PATCH':'POST',{title,reference,court,client,summary:record?{...record.summary,[lang]:summary}:summary});close();await invalidateAll();if(!record)await goto('/case/'+item.id);
  }catch(e){message=e instanceof Error?e.message:(en?'Could not save case.':'Perkara belum tersimpan.')}finally{busy=false}}
</script>
<Dialog title={record?(en?'Case settings':'Pengaturan perkara'):(en?'New case':'Perkara baru')} {lang} {close}>
<form class="stack" onsubmit={submit}>
<label class="field">{en?'Case title':'Judul perkara'}<input required maxlength="200" bind:value={title} /></label>
<label class="field">{en?'Case number':'Nomor perkara'}<input bind:value={reference} maxlength="200" placeholder="112/Pid.B/2026/PN…"/></label>
<label class="field">{en?'Court':'Pengadilan'}<input bind:value={court} maxlength="240"/></label>
<label class="field">{en?'Client':'Klien'}<input bind:value={client} maxlength="150"/></label>
<label class="field">{en?'Case summary':'Ringkasan perkara'}<textarea bind:value={summary} maxlength="4000"></textarea></label>
{#if message}<p role="alert" class="error-text">{message}</p>{/if}
<div class="actions"><button type="submit" class="button primary" disabled={busy}>{record?(en?'Save changes':'Simpan perubahan'):(en?'Create case':'Buat perkara')}</button><button class="button subtle" type="button" onclick={close}>{en?'Cancel':'Batal'}</button></div></form></Dialog>
