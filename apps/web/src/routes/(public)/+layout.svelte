<script lang="ts">
	import '$lib/public/public.css';
	import PublicNav from '$lib/public/PublicNav.svelte';
	import PublicFooter from '$lib/public/PublicFooter.svelte';
	import type { LayoutProps } from './$types';
	let { data, children }: LayoutProps = $props();
</script>
<div class="public-world">
	<a class="pub-skip" href="#public-main">{data.lang === 'id' ? 'Lewati ke isi' : 'Skip to content'}</a>
	<PublicNav lang={data.lang} signedIn={Boolean(data.session?.user)}/>
	<main id="public-main" tabindex="-1">{@render children()}</main>
	<PublicFooter lang={data.lang}/>
</div>
