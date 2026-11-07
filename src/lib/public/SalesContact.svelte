<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick, onMount } from 'svelte';
	import type { Language } from './plans';
	import Icon from './Icon.svelte';
	let { lang, initial = false, profile, result }: { lang: Language; initial?: boolean; profile?: { name: string; email: string } | null; result?: { kind?: string; ok?: boolean; error?: string; values?: Record<string,string | undefined> } | null } = $props();
	let isId = $derived(lang === 'id');
	let dialog = $state<HTMLDialogElement>();
	let mounted = $state(false);
	let busy = $state(false);
	let opener: HTMLElement | null = null;
	const title = 'sales-heading';
	export async function open() {
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		await tick();
		if (dialog && !dialog.open) dialog.showModal();
	}
	function close() { dialog?.close(); }
	onMount(() => {
		mounted = true;
		if (initial || result?.kind === 'sales') void open();
	});
</script>
{#snippet content()}
	{#if mounted}<button type="button" class="close-sales" aria-label={isId ? 'Tutup' : 'Close'} onclick={close}><Icon name="close" size={18}/></button>{/if}
	<h2 id={title}>{isId ? 'Hubungi tim Jude.' : 'Contact the Jude team.'}</h2>
	{#if result?.kind === 'sales' && result.ok}
		<p class="pub-feedback" role="status">{isId ? 'Permintaan Anda sudah diterima. Alamat balasan' : 'Your enquiry has been received. Reply address'} <strong>{result.values?.email}</strong>.</p>
	{:else}
		<p class="sales-lead">{isId ? 'Ceritakan kebutuhan organisasi Anda untuk mendiskusikan paket Mitra.' : 'Tell us about your organisation to discuss a Partner plan.'}</p>
		<form method="POST" action="?/contact" class="pub-form" use:enhance={() => {
			busy = true; return async ({update}) => { try { await update({reset:false}); } finally { busy = false; } };
		}}>
			{#if result?.kind === 'sales' && result.error}<p class="pub-feedback error" role="alert">{isId ? 'Periksa nama, email, dan ukuran tim Anda, lalu kirim kembali.' : 'Check your name, email and team size, then send again.'}</p>{/if}
			<label>{isId ? 'Nama' : 'Name'}<input required name="name" maxlength="100" autocomplete="name" value={result?.values?.name ?? profile?.name ?? ''}/></label>
			<label>Email<input required type="email" name="email" maxlength="254" autocomplete="email" value={result?.values?.email ?? profile?.email ?? ''}/></label>
			<div class="sales-pair"><label>{isId ? 'Kantor atau organisasi' : 'Firm or organisation'}<input name="org" autocomplete="organization" maxlength="180" value={result?.values?.org ?? ''}/></label><label>{isId ? 'Ukuran tim' : 'Team size'}<input type="number" name="size" min="1" max="100000" value={result?.values?.size ?? ''}/></label></div>
			<label>{isId ? 'Kebutuhan tim (opsional)' : 'Team requirements (optional)'}<textarea name="message" rows="3" maxlength="2000" value={result?.values?.message ?? ''}></textarea></label>
			<label class="trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"/></label>
			<button class="pub-button" disabled={busy}>{isId ? 'Kirim permintaan' : 'Send enquiry'}<Icon name="arrow"/></button>
		</form>
	{/if}
{/snippet}
{#if mounted}
	<dialog bind:this={dialog} id="partner" aria-labelledby={title} onclose={() => opener?.focus()}>{@render content()}</dialog>
{:else if initial || result?.kind === 'sales'}
	<section class="sales-inline" id="partner" aria-labelledby={title}>{@render content()}</section>
{/if}
<style>
	dialog,.sales-inline { border:0; border-radius:6px; width:min(calc(100% - 32px),480px); padding:clamp(23px,4vw,40px); background:#f8f4e8; color:#25392a; }
	dialog { position:fixed; max-height:90svh; overflow-y:auto; }
	dialog::backdrop { background:#10281fc2; }
	.sales-inline { position:relative; margin:30px auto; }
	.close-sales { width:44px; height:44px; display:grid; place-items:center; border:0; border-radius:4px; background:transparent; color:#354d3a; position:absolute; right:8px; top:8px; cursor:pointer; }
	h2 { font-size:2.35rem; margin-right:20px!important; }
	.sales-lead { font-size:.9rem; color:#4f5b50; margin:12px 0 21px!important; }
	.sales-pair { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr); gap:12px; }
	.pub-feedback { margin-top:18px!important; }
</style>
