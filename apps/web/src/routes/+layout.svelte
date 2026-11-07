<script lang="ts">
  import '../app.css';
  import { browser } from '$app/environment';
  let { data, children } = $props();
  $effect(() => { if (browser) document.documentElement.lang = data.lang; });
</script>
{@render children()}
