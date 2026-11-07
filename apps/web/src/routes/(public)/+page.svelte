<script lang="ts">
	import { page } from '$app/state';
	import LandingStory from '$lib/public/landing/LandingStory.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let title = $derived(data.lang === 'id' ? 'Jude · Kecerdasan ruang sidang berbasis bukti' : 'Jude · Evidence-grounded courtroom intelligence');
	let description = $derived(data.lang === 'id' ? 'Ikuti keterangan saksi dan telusuri kutipan sampai ke berkas perkara aslinya.' : 'Follow witness testimony and trace a quotation back to the original case file.');
</script>
<svelte:head>
	<title>{title}</title><meta name="description" content={description}/><meta property="og:title" content={title}/><meta property="og:description" content={description}/><meta property="og:type" content="website"/><meta property="og:image" content={new URL('/public/case-preview.jpg', page.url.origin).href}/><meta name="twitter:card" content="summary_large_image"/>
</svelte:head>
<LandingStory lang={data.lang} record={data.record}/>
