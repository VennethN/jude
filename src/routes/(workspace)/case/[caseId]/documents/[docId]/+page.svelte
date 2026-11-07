<script lang="ts">
  import Reader from '$lib/evidence/Reader.svelte';
  import type { PageData } from './$types';
  let {data}: {data:PageData} = $props();
</script>
{#key data.documentId}<Reader workspace={data.workspace} lang={data.lang} docId={data.documentId}/>{/key}

