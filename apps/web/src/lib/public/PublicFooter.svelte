<script lang="ts">
	import Wordmark from './Wordmark.svelte';
	import Icon from './Icon.svelte';
	import type { Language } from '@jude/core/plans';
	let { lang }: { lang: Language } = $props();
	let isId = $derived(lang === 'id');
</script>
<footer class="pub-footer">
	<div class="pub-frame inner">
		<Wordmark />
		<span>{isId ? 'Ruang kerja untuk advokat.' : 'A workspace for advocates.'}</span>
		<nav aria-label={isId ? 'Navigasi kaki halaman' : 'Footer navigation'}><a href="/pricing">{isId ? 'Harga' : 'Pricing'}</a><a href="/cases">{isId ? 'Ruang kerja' : 'Workspace'} <Icon name="forward" size={14}/></a></nav>
	</div>
</footer>
<style>
	.pub-footer { color: #e8eddf; background: #142f26; }
	.inner { min-height: 105px; display: flex; align-items: center; flex-wrap: wrap; gap: 26px; }
	.inner > span { font-size: .79rem; color: #c2d0c2; }
	nav { margin-left: auto; display: flex; gap: 20px; }
	nav a { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; color: inherit; font-size: .84rem; }
	@media(max-width: 600px) { .inner { padding-block: 20px; gap: 10px 15px; } nav { margin: 0; width: 100%; } }
</style>
