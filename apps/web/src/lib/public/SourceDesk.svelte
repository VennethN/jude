<script lang="ts">
	import type { Lang } from '@jude/core/domain';
	import { onMount } from 'svelte';
	import { ArrowUpRight } from '@lucide/svelte';
	import { around, sources, type LandingRecord } from './landing/landing-record';
	let {lang,record}: {lang:Lang;record:LandingRecord} = $props();
	let selected = $state(0);
	let source = $derived(sources[selected]);
	let passage = $derived(around(record[source.key],source.mark));
	let ready = $state(false);
	onMount(() => { ready = true; });

	function move(event: KeyboardEvent, index: number) {
		const keys = ['ArrowLeft','ArrowRight','Home','End'];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		const last = sources.length - 1;
		selected = event.key === 'Home' ? 0 : event.key === 'End' ? last : (index + (event.key === 'ArrowRight' ? 1 : -1) + sources.length) % sources.length;
		const group = (event.currentTarget as HTMLButtonElement).parentElement;
		group?.querySelectorAll('button')[selected]?.focus({ preventScroll: true });
	}
</script>

<div class="desk-picker">
	{#if ready}
	<div class="desk-tabs" role="group" aria-label={lang === 'id' ? 'Pilih sumber' : 'Choose a source'}>
		{#each sources as source, index (source.key)}
			<button type="button" aria-pressed={selected === index} onclick={() => selected = index} onkeydown={event => move(event,index)}>{source.name[lang]}</button>
		{/each}
	</div>
	{:else}
	<nav class="direct-sources" aria-label={lang === 'id' ? 'Buka sumber' : 'Open a source'}>
		{#each sources as item (item.key)}<a href={item.href}>{item.name[lang]}</a>{/each}
	</nav>
	{/if}
	<div class="reading excerpt" aria-live="polite" aria-atomic="true">
		<blockquote lang="id" class:testimony={source.key === 'testimony'}>{passage[0]}<mark>{passage[1]}</mark>{passage[2]}</blockquote>
		<a href={source.href}>{lang === 'id' ? 'Buka sumber dalam perkara' : 'Open source in case'} <ArrowUpRight size={15} aria-hidden="true"/></a>
	</div>
</div>

<style>
	.desk-picker { min-width:0; color:var(--lp-cream); }
	.desk-tabs { display:flex; flex-wrap:wrap; gap:0 .55rem; border-bottom:1px solid color-mix(in srgb,var(--lp-cream) 29%,transparent); }
	.desk-tabs button { min-height:44px; padding:.25rem .2rem; background:transparent; border:0; border-bottom:2px solid transparent; color:inherit; font:600 .85rem/1.3 var(--pub-body); }
	.desk-tabs button[aria-pressed="true"] { color:var(--lp-amber); border-bottom-color:currentColor; }
	.desk-tabs button:hover,.excerpt a:hover { text-decoration:underline; }
	.excerpt { padding:.8rem 1rem 0; margin-top:.6rem; border-radius:6px; color:var(--lp-ink); background:var(--lp-paper) url('/public/ivory-paper.webp') center/600px; }
	.excerpt blockquote { font:400 .96rem/1.48 var(--pub-record); text-wrap:pretty; }
	.excerpt blockquote.testimony { font-family:var(--pub-body); }
	.excerpt mark { color:inherit; background:var(--lp-amber-wash); box-decoration-break:clone; -webkit-box-decoration-break:clone; }
	.excerpt a { display:inline-flex; align-items:center; gap:.35em; min-height:44px; color:var(--pub-plum); font:600 .8rem/1.4 var(--pub-body); }
	.direct-sources { display:flex; flex-wrap:wrap; gap:.85rem; }
	.direct-sources a { display:inline-flex; align-items:center; min-height:44px; color:inherit; }
	.desk-picker a:focus-visible,.desk-tabs button:focus-visible { outline-offset:1px; }
</style>
