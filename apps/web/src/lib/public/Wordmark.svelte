<script lang="ts">
	let { home = '/', label = 'Jude' }: { home?: string; label?: string } = $props();
</script>
<a class="wordmark" href={home} aria-label={label}>jude.</a>

<style>
	.wordmark { color: inherit; font: 400 3rem/1 Rufina, Georgia, serif; letter-spacing: -.035em; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; padding-block-end: .06em; }
</style>
