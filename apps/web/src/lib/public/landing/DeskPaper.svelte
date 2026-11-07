<script lang="ts">
  import { across } from './landing-desk';
  import type { LandingRecord } from './landing-record';
  import type { Lang } from '@jude/core/domain';
  import { translate, type Key } from './landing-text';

  let { kind, record, lang }: { kind: 'roster' | 'log'; record: LandingRecord; lang: Lang } = $props();
  const t = $derived((key: Key) => translate(lang, key));
  const shift = $derived(record.schedule.match(/(\d{2}[.:]\d{2}) (?:sampai|to) (\d{2}[.:]\d{2})/));
  const entry = $derived(record.gate.match(/\d{2}:\d{2}:\d{2}/)?.[0]);
  const exit = $derived(record.vehicleLog.match(/\d{2}:\d{2}:\d{2}/)?.[0]);
</script>

{#if kind === 'roster'}
  <p class="pp-head">{t('lp.paper.roster')}</p>
  {#if shift}
    <p class="pp-row" style:--row={0}><span>{t('lp.paper.guard')}</span><span>Rina Hartati</span></p>
    <p class="pp-row" style:--row={1}>
      <span>{t('lp.paper.start')}</span><mark class="tb-c" style:--mx={across('roster', 0.7, 0.62)}>{shift[1]} WIB</mark>
    </p>
    <p class="pp-row" style:--row={2}>
      <span>{t('lp.paper.end')}</span><mark class="tb-c" style:--mx={across('roster', 0.7, 0.79)}>{shift[2]} WIB</mark>
    </p>
  {:else}
    <p class="pp-typed">{record.schedule}</p>
  {/if}
{:else}
  <p class="pp-folio">7–8 / 12</p>
  <p class="pp-head">{t('lp.paper.log')}</p>
  <p class="pp-sub">{t('lp.paper.logDate')}</p>
  {#if entry && exit}
    <p class="pp-row pp-typed" style:--row={0}><span>{t('lp.paper.time')}</span><span>{t('lp.paper.gate')}</span><span>{t('lp.paper.notes')}</span></p>
    <p class="pp-row pp-typed" style:--row={1}>
      <mark class="tb-c key" style:--mx={across('log', 0.24, 0.66)}>{entry}</mark><span>{t('lp.paper.east')}</span><span
        >R. Hartati</span
      >
    </p>
    <p class="pp-row pp-typed" style:--row={2}>
      <mark class="tb-c" style:--mx={across('log', 0.24, 0.82)}>{exit}</mark><span>{t('lp.paper.east')}</span><span
        >{t('lp.paper.truck')}</span
      >
    </p>
  {:else}
    <p class="pp-typed">{record.gate}</p>
  {/if}
{/if}
