<script lang="ts">
  import BrandLockup from '$lib/BrandLockup.svelte';
  let { home = '/', label = 'Jude.', monochrome = true }: {
    home?: string;
    label?: string;
    monochrome?: boolean;
  } = $props();
</script>
<a class="wordmark" href={home} aria-label={label}><BrandLockup {monochrome}/></a>

<style>
	.wordmark { color: inherit; font: 400 3rem/1 Rufina, Georgia, serif; letter-spacing: -.035em; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; padding-block-end: .06em; }
</style>
