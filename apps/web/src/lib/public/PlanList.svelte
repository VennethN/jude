<script lang="ts">
  import {
    currency,
    localized,
    type BillingCycle,
    type Language,
    type Plan,
    type PlanId,
  } from '@jude/core/plans';
  import Icon from './Icon.svelte';
  import PlanPlate from './PlanPlate.svelte';
  import PlanAction from './PlanAction.svelte';
  import { period, price, quotaValue } from './pricing';

  let {
    plans,
    lang,
    cycle,
    signedIn,
    selected,
    current,
    contact,
  }: {
    plans: Plan[];
    lang: Language;
    cycle: BillingCycle;
    signedIn: boolean;
    selected?: string | null;
    current?: PlanId;
    contact: () => void;
  } = $props();
  const id = $derived(lang === 'id');
  const contractCapacity = {
    hours: localized('Jam sidang sesuai kontrak', 'Hearing hours by arrangement'),
    cases: localized('Jumlah perkara sesuai kontrak', 'Case capacity by arrangement'),
    boards: localized('Papan sesuai kontrak', 'Boards by arrangement'),
    questions: localized('Pertanyaan sesuai kontrak', 'Questions by arrangement'),
  };
  const capacities = [
    { key: 'hours', unit: localized('jam sidang per bulan', 'hearing hours a month') },
    { key: 'cases', unit: localized('perkara aktif', 'active cases') },
    { key: 'boards', unit: localized('papan temuan', 'findings boards') },
    { key: 'questions', unit: localized('pertanyaan asisten per bulan', 'assistant questions a month') },
  ] as const;
</script>

<div class="plans-grid">
  {#each plans as plan, i (plan.id)}
    <article
      id={'plan-' + plan.id}
      aria-labelledby={'plate-' + plan.id}
      class:pro={plan.id === 'pro'}
      class:selected={selected === plan.id}
    >
      {#if plan.id === 'pro'}
        <span class="ribbon">{id ? 'Disarankan untuk advokat' : 'Recommended for advocates'}</span>
        <img class="clip" src="/public/clip.webp" alt="" width="52" height="81" decoding="async" />
      {/if}
      <h2 id={'plate-' + plan.id}><PlanPlate {plan} {lang} /></h2>
      <p class="tagline">{plan.tagline[lang]}</p>
      <div class="price">
        <strong class:custom={plan.contract}>{price(plan, cycle, lang)}</strong>{#if plan.monthly}<span
            >{period(plan, lang)}</span
          >{/if}
      </div>
      <p class="billed" class:yearly={cycle === 'yearly'}>
        {#if plan.contract}{id
            ? 'Kontrak tahunan. Bicarakan kebutuhan tim Anda.'
            : 'Annual contract. Discuss your team’s requirements.'}
        {:else if plan.monthly === 0}{id ? 'Gratis selamanya.' : 'Free, forever.'}
        {:else if cycle === 'yearly'}{id ? 'Ditagih ' : 'Billed '}{currency(plan.yearly!, lang)}
          {id ? 'per tahun.' : 'a year.'}
          <span class="saving">{id ? 'Hemat ' : 'Save '}{currency(plan.yearlySaving!, lang)}</span>
        {:else}{id ? 'Ditagih setiap bulan.' : 'Billed monthly.'}{/if}
      </p>
      <PlanAction {plan} {lang} {cycle} {signedIn} {current} {contact} />
      <p class="fine">
        {#if plan.trial}{id ? 'Tanpa kartu kredit' : 'No credit card'}{/if}
      </p>
      <ul class="quotas" aria-label={id ? 'Kuota paket' : 'Plan quotas'}>
        {#each capacities as cap}
          <li>
            {#if plan.contract}{contractCapacity[cap.key][lang]}
            {:else if plan.quotas[cap.key] === null}{cap.unit[lang]} · {quotaValue(plan, cap.key, lang)}
            {:else}<strong>{quotaValue(plan, cap.key, lang)}</strong> {cap.unit[lang]}{/if}
          </li>
        {/each}
      </ul>
      <ul class="benefits" aria-label={id ? 'Fitur paket' : 'Plan features'}>
        {#if i > 0 && !plan.contract}<li>
            <Icon name="check" size={15} /><span
              >{id ? 'Semua fitur ' : 'Everything in '}{plans[i - 1].name[lang]}</span
            >
          </li>{/if}
        {#each plan.bullets as benefit}<li>
            <Icon name="check" size={15} /><span>{benefit[lang]}</span>
          </li>{/each}
      </ul>
    </article>
  {/each}
</div>

<style>
  .plans-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 16px;
    padding-top: 20px;
  }
  article {
    position: relative;
    display: grid;
    grid-row: span 8;
    grid-template-rows: subgrid;
    row-gap: 0;
    min-width: 0;
    padding: 26px 24px 30px;
    border-radius: 12px;
    background: #f5eee2 url('/public/ivory-paper.webp') repeat center/600px;
    color: #253b2d;
    box-shadow:
      0 22px 42px -23px #04140ccc,
      0 2px 5px #04140c30;
    scroll-margin: 50px;
  }
  article.pro {
    outline: 2px solid #e2b671;
  }
  article.selected {
    outline: 3px solid #bd8a41;
  }
  .ribbon {
    position: absolute;
    left: 18px;
    top: 0;
    transform: translateY(-50%);
    border-radius: 99px;
    padding: 5px 13px;
    background: #e8bf80;
    color: #3e2e16;
    font: 600 12px/1.35 var(--pub-body);
  }
  .clip {
    position: absolute;
    top: -44px;
    right: 18px;
    width: 52px;
    height: auto;
    filter: drop-shadow(0 3px 3px #42341a4d);
    pointer-events: none;
  }
  h2 {
    min-width: 0;
    align-self: start;
  }
  .tagline {
    min-height: 65px;
    margin: 16px 0 22px;
    color: #475448;
    font-size: 15px;
    line-height: 1.55;
  }
  .price {
    display: grid;
    align-content: start;
    gap: 2px;
  }
  .price strong {
    font: 400 clamp(36px, 2.9vw, 44px)/1 var(--pub-display);
    letter-spacing: -0.025em;
    font-variant-numeric: tabular-nums;
  }
  .price .custom {
    font-size: clamp(30px, 2.3vw, 37px);
  }
  .price span,
  .billed,
  .fine {
    color: #566054;
    font-size: 13px;
    line-height: 1.55;
  }
  .billed {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-content: start;
    align-items: center;
    margin: 9px 0 20px;
  }
  .billed.yearly {
    min-height: 73px;
  }
  .saving {
    border-radius: 4px;
    background: #eddfbe;
    color: #604320;
    font-size: 12px;
    padding: 1px 5px;
  }
  .fine {
    min-height: 22px;
    margin: 8px 0 14px;
    text-align: center;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .quotas {
    margin-bottom: 16px;
    font-size: 14px;
    line-height: 1.65;
  }
  .quotas li {
    padding: 8px 0;
    border-top: 1px solid #23382b22;
  }
  .quotas strong {
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .benefits {
    min-height: 145px;
    display: grid;
    align-content: start;
    gap: 9px;
    font-size: 14px;
    line-height: 1.5;
  }
  .benefits li {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .benefits :global(svg) {
    flex: none;
    color: #31573c;
    transform: translateY(2px);
  }
  @media (max-width: 1100px) {
    .plans-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: 34px;
    }
  }
  @media (max-width: 700px) {
    .plans-grid {
      grid-auto-flow: column;
      grid-template-columns: none;
      grid-auto-columns: 84%;
      gap: 0 12px;
      margin-inline: -20px;
      padding: 26px 20px 18px;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scroll-snap-type: x mandatory;
      scroll-padding-inline: 20px;
      scrollbar-width: none;
    }
    .plans-grid::-webkit-scrollbar {
      display: none;
    }
    article {
      scroll-snap-align: start;
    }
    .clip {
      display: none;
    }
  }
  @media (prefers-reduced-motion: no-preference) and (hover: hover) {
    article {
      transition: translate 0.35s ease;
    }
    article:hover {
      translate: 0 -4px;
    }
  }
</style>
