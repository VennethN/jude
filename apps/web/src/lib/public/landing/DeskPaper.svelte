<script lang="ts">
  import { across } from './landing-desk';
  import type { LandingRecord } from './landing-record';

  let { kind, record }: { kind: 'roster' | 'log'; record: LandingRecord } = $props();
  const shift = $derived(record.schedule.match(/(\d{2}\.\d{2}) sampai (\d{2}\.\d{2})/));
  const entry = $derived(record.gate.match(/\d{2}:\d{2}:\d{2}/)?.[0]);
  const exit = $derived(record.vehicleLog.match(/\d{2}:\d{2}:\d{2}/)?.[0]);
</script>

{#if kind === 'roster'}
  <p class="pp-head">JADWAL JAGA GUDANG B</p>
  {#if shift}
    <p class="pp-row" style:--row={0}><span>Petugas</span><span>Rina Hartati</span></p>
    <p class="pp-row" style:--row={1}>
      <span>Mulai jaga</span><mark class="tb-c" style:--mx={across('roster', 0.7, 0.62)}>{shift[1]} WIB</mark>
    </p>
    <p class="pp-row" style:--row={2}>
      <span>Selesai</span><mark class="tb-c" style:--mx={across('roster', 0.7, 0.79)}>{shift[2]} WIB</mark>
    </p>
  {:else}
    <p class="pp-typed">{record.schedule}</p>
  {/if}
{:else}
  <p class="pp-folio">7–8 / 12</p>
  <p class="pp-head">LAPORAN LOG AKSES GERBANG</p>
  <p class="pp-sub">Gudang B · 14 Maret 2026</p>
  {#if entry && exit}
    <p class="pp-row pp-typed" style:--row={0}><span>Waktu</span><span>Gerbang</span><span>Catatan</span></p>
    <p class="pp-row pp-typed" style:--row={1}>
      <mark class="tb-c key" style:--mx={across('log', 0.24, 0.66)}>{entry}</mark><span>Timur</span><span
        >R. Hartati</span
      >
    </p>
    <p class="pp-row pp-typed" style:--row={2}>
      <mark class="tb-c" style:--mx={across('log', 0.24, 0.82)}>{exit}</mark><span>Timur</span><span
        >Boks putih</span
      >
    </p>
  {:else}
    <p class="pp-typed">{record.gate}</p>
  {/if}
{/if}
