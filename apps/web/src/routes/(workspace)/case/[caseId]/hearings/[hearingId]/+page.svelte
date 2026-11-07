<script lang="ts">
  import type { PageData } from './$types';
  import HearingDetail from '$lib/workspace/hearing-detail/HearingDetail.svelte';

  let { data }: { data: PageData } = $props();
</script>

{#key data.hearingId}<HearingDetail
    workspace={data.workspace}
    hearingId={data.hearingId}
    lang={data.lang}
    account={data.account}
    transcription={data.transcription}
  />{/key}
