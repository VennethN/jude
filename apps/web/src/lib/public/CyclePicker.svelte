<script lang="ts">
  import { page } from '$app/state';
  import { type Language, type BillingCycle } from '@jude/core/plans';
  let { lang, cycle, cover = false }: { lang: Language; cycle: BillingCycle; cover?: boolean } = $props();
  const options: BillingCycle[] = ['monthly', 'yearly'];
  function href(to: BillingCycle) {
    const query = new URLSearchParams(page.url.search);
    query.delete('contact');
    query.delete('/plan');
    query.delete('/contact');
    query.set('cycle', to);
    return page.url.pathname + '?' + query.toString() + (cover ? '' : '#plans');
  }
</script>

<nav class="cycle-switch" class:cover aria-label={lang === 'id' ? 'Siklus tagihan' : 'Billing cycle'}>
  {#each options as option}<a href={href(option)} aria-current={option === cycle ? 'true' : undefined}
      >{option === 'yearly'
        ? lang === 'id'
          ? 'Tahunan'
          : 'Yearly'
        : lang === 'id'
          ? 'Bulanan'
          : 'Monthly'}{#if cover && option === 'yearly'}<small
          >{lang === 'id' ? '2 bulan gratis' : '2 months free'}</small
        >{/if}</a
    >{/each}
</nav>

<style>
  .cycle-switch {
    display: inline-flex;
    align-items: center;
    padding: 3px;
    border: 1px solid #b5beac;
    border-radius: 6px;
    background: #e9ecdf;
    color: #364a37;
  }
  .cycle-switch a {
    min-height: 42px;
    display: grid;
    place-items: center;
    padding: 6px 18px;
    border-radius: 3px;
    color: inherit;
    text-decoration: none;
    font: 600 0.86rem/1.3 var(--pub-body);
  }
  .cycle-switch a[aria-current] {
    background: #fffcf2;
    color: #213b2b;
    box-shadow: 0 1px 4px #3445312b;
  }
  .cover {
    padding: 4px;
    border-radius: 30px;
    background: transparent;
    color: #f0efde;
    border-color: #aab9a7a1;
    width: fit-content;
  }
  .cover a {
    display: inline-flex;
    gap: 9px;
    border-radius: 30px;
    align-items: center;
    padding-inline: 14px;
    font-size: 1rem;
    font-weight: 500;
  }
  .cover a[aria-current] {
    background: #f4efdf;
  }
  .cover small {
    font-size: 0.77rem;
    background: #ebc27b;
    color: #3c331e;
    padding: 5px 8px;
    border-radius: 16px;
    white-space: nowrap;
  }
</style>
