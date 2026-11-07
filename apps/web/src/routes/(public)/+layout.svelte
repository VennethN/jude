<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import '$lib/public/public.css';
  import PublicNav from '$lib/public/PublicNav.svelte';
  import PublicFooter from '$lib/public/PublicFooter.svelte';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
  const cover = $derived(page.url.pathname === '/' || page.url.pathname === '/pricing');
  let scale = $state(1);

  onMount(() => {
    // Only scale on browsers that measure viewport units in the zoomed coordinate space.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;zoom:2;width:100px;height:10vh';
    document.body.append(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();
    if (Math.abs(rect.width - 200) >= 1 || Math.abs(rect.height - innerHeight * .2) >= 2) return;
    function fit() {
      const ratio = Math.min(innerWidth / 1440, innerHeight / 880);
      scale = ratio > 1.04 ? Math.min(2, Math.round(ratio * 1000) / 1000) : 1;
    }
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
</script>

<div class="public-world" style:--z={cover ? scale : 1} style:zoom={cover ? scale : 1}>
  <a class="pub-skip" href="#public-main">{data.lang === 'id' ? 'Lewati ke isi' : 'Skip to content'}</a>
  <PublicNav lang={data.lang} signedIn={Boolean(data.session?.user)}/>
  <main id="public-main" tabindex="-1">{@render children()}</main>
  <PublicFooter lang={data.lang} />
</div>
