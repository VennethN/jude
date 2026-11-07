<script lang="ts">
  import type { BillingCycle, Language, Plan, PlanId } from '@jude/core/plans';
  import Icon from './Icon.svelte';
  import PlanPlate from './PlanPlate.svelte';
  import PlanAction from './PlanAction.svelte';
  import { comparison, isQuota, period, price, quotaValue, rowNames } from './pricing';
  let {
    plans,
    lang,
    cycle,
    signedIn,
    current,
    contact,
  }: {
    plans: Plan[];
    lang: Language;
    cycle: BillingCycle;
    signedIn: boolean;
    current?: PlanId;
    contact: () => void;
  } = $props();
  const id = $derived(lang === 'id');
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (The table scrolls horizontally on small screens.) -->
<div class="table-wrap" role="region" tabindex="0" aria-label={id ? 'Perbandingan paket' : 'Plan comparison'}>
  <table>
    <caption class="sr-only">{id ? 'Kuota dan fitur menurut paket' : 'Quotas and features by plan'}</caption>
    <thead
      ><tr>
        <th scope="col" class="row-name"
          ><span class="sr-only">{id ? 'Kuota atau fitur' : 'Quota or feature'}</span></th
        >
        {#each plans as plan (plan.id)}
          <th scope="col" class:pro={plan.id === 'pro'}>
            <PlanPlate {plan} {lang} size="sm" />
            <span class="price"
              >{price(plan, cycle, lang)}
              {#if period(plan, lang)}<small>{period(plan, lang)}</small>{/if}</span
            >
          </th>
        {/each}
      </tr></thead
    >
    {#each comparison as group}
      <tbody>
        <tr class="category">
          <th scope="rowgroup">{group.title[lang]}</th>
          {#each plans as plan}<td class:pro={plan.id === 'pro'}></td>{/each}
        </tr>
        {#each group.rows as key}
          <tr>
            <th scope="row">{rowNames[key][lang]}</th>
            {#each plans as plan}
              <td class:pro={plan.id === 'pro'}>
                {#if isQuota(key)}{quotaValue(plan, key, lang)}
                {:else if plan.contract && ['sso_audit_log', 'jakarta_residency', 'dedicated_contact'].includes(key)}
                  <span class="terms">{id ? 'Sesuai kontrak' : 'By arrangement'}</span>
                {:else if plan.features.includes(key)}
                  <Icon name="check" size={17} /><span class="sr-only">{id ? 'Termasuk' : 'Included'}</span>
                {:else}<span class="dash" aria-hidden="true">−</span><span class="sr-only"
                    >{id ? 'Di luar paket' : 'Not included'}</span
                  >{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    {/each}
    <tfoot
      ><tr>
        <td></td>
        {#each plans as plan}<td class:pro={plan.id === 'pro'}
            ><PlanAction {plan} {lang} {cycle} {current} {signedIn} {contact} placement="table" /></td
          >{/each}
      </tr></tfoot
    >
  </table>
</div>

<style>
  .table-wrap {
    position: relative;
    overflow: clip;
    border-radius: 14px;
    background: #f5eee2 url('/public/ivory-paper.webp') repeat center/600px;
    box-shadow:
      0 1px 0 #111c1610,
      0 24px 50px -30px #14281e55;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
    overflow: hidden;
    white-space: nowrap;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font: 400 14.5px/1.65 var(--pub-body);
    color: #233a2c;
  }
  th,
  td {
    vertical-align: middle;
    text-align: center;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 20px 14px 18px;
    background: #f4ede1;
    border-bottom: 1px solid #14281f27;
    vertical-align: bottom;
  }
  .row-name {
    width: 34%;
  }
  .price {
    display: block;
    margin-top: 8px;
    font: 400 19px/1.65 var(--pub-display);
    font-variant-numeric: tabular-nums;
  }
  .price small,
  .terms {
    font: 400 12px/1.4 var(--pub-body);
    color: #526052;
  }
  .price small {
    white-space: nowrap;
  }
  tbody td,
  tbody th {
    padding: 13px 14px;
    border-top: 1px solid #14281f15;
    font-variant-numeric: tabular-nums;
  }
  tbody th {
    text-align: left;
    padding-left: 28px;
    font-weight: 400;
  }
  .category th,
  .category td {
    border: 0;
  }
  .category th {
    padding-block: 30px 10px;
    font: 400 23px/1.65 var(--pub-display);
  }
  .pro {
    background-color: #e9bf7c20;
  }
  thead th.pro {
    background: #efe3cc;
  }
  td :global(svg) {
    color: #32573d;
    vertical-align: middle;
  }
  .dash {
    color: #70796b;
  }
  tfoot td {
    padding: 22px 10px 26px;
  }
  @media (max-width: 900px) {
    .table-wrap {
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: thin;
    }
    table {
      min-width: 730px;
    }
    thead th {
      position: static;
    }
    tbody th,
    thead .row-name {
      position: sticky;
      left: 0;
      z-index: 1;
      background: #f4ede1;
    }
    .row-name {
      width: 210px;
    }
    tfoot {
      display: none;
    }
  }
</style>
