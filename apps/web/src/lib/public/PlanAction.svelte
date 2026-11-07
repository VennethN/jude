<script lang="ts">
  import Icon from './Icon.svelte';
  import { actionHref, actionLabel } from './pricing';
  import type { BillingCycle, Language, Plan, PlanId } from '@jude/core/plans';
  let {
    plan,
    cycle,
    lang,
    signedIn,
    current,
    contact,
    placement = 'card',
  }: {
    plan: Plan;
    cycle: BillingCycle;
    lang: Language;
    signedIn: boolean;
    current?: PlanId;
    contact: () => void;
    placement?: 'card' | 'table' | 'hero' | 'bar';
  } = $props();
  const active = $derived(signedIn && current === plan.id);
</script>

<a
  class="action"
  class:primary={plan.id === 'pro'}
  class:compact={placement === 'table' || placement === 'bar'}
  class:light={placement === 'hero'}
  href={active ? '/billing?plan=' + plan.id + '&cycle=' + cycle : actionHref(plan, cycle, signedIn)}
  onclick={(event) => {
    if (plan.contract && !active && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      contact();
    }
  }}
>
  {placement === 'table' && plan.contract && !active
    ? lang === 'id'
      ? 'Bahas paket Mitra'
      : 'Discuss the Partner plan'
    : actionLabel(plan, lang, current)}{#if placement !== 'table'}<Icon
      name="arrow"
      size={placement === 'hero' ? 20 : 16}
    />{/if}
</a>

<style>
  .action {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 50px;
    padding: 9px 17px;
    border: 1px solid #1e3e30;
    border-radius: 7px;
    background: transparent;
    color: #173a2b;
    text-decoration: none;
    font: 400 1.16rem/1.25 var(--pub-display);
  }
  .action:hover,
  .action.primary {
    background: #193d2d;
    color: #fbf1de;
  }
  .action.primary:hover {
    background: #123023;
  }
  .action.compact {
    min-height: 42px;
    padding: 6px 12px;
    justify-content: center;
    font-size: 1.04rem;
  }
  .action.light {
    background: #f5ebd7;
    color: #183527;
    min-height: 54px;
    border-color: #f5ebd7;
    border-radius: 8px;
    font-size: 1.28rem;
  }
  .action.light:hover {
    background: #ffecc8;
    color: #183527;
  }
  @media (max-width: 700px) {
    .action.light {
      width: 100%;
      justify-content: center;
    }
  }
</style>
