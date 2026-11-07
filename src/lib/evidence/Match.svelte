<script lang="ts">
  let { text, term }: { text: string; term?: string } = $props();
  let parts = $derived.by(() => {
    const q = term?.trim();
    if (!q) return [{ value: text, hit: false }];
    const hay = text.toLowerCase(), needle = q.toLowerCase();
    const result: { value: string; hit: boolean }[] = [];
    let start = 0, found = hay.indexOf(needle);
    while (found >= 0) {
      if (found > start) result.push({value: text.slice(start, found), hit: false});
      result.push({value: text.slice(found, found + needle.length), hit: true});
      start = found + needle.length;
      found = hay.indexOf(needle, start);
    }
    if (start < text.length) result.push({value: text.slice(start), hit: false});
    return result;
  });
</script>
{#each parts as part}{#if part.hit}<mark class="ev-mark">{part.value}</mark>{:else}{part.value}{/if}{/each}

