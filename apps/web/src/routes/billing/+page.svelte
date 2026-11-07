<script lang="ts">
	import '$lib/public/public.css';
	import CyclePicker from '$lib/public/CyclePicker.svelte';
	import { enhance } from '$app/forms';
  import { afterNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { CreditCard, Check, ArrowLeft, Infinity as Unlimited } from '@lucide/svelte';
  import PlanPlate from '$lib/public/PlanPlate.svelte';
	import SalesContact from '$lib/public/SalesContact.svelte';
	import Wordmark from '$lib/public/Wordmark.svelte';

	import { planById, quotaOrder, quotaNames, quotaHelp, localized, currency, type QuotaId, type Plan, type BillingCycle } from '@jude/core/plans';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let isId = $derived(data.lang === 'id');
	let plan = $derived(planById(data.account.planId));
	let contactForm: SalesContact;
	function quota(key: QuotaId) {
		const value = data.account.usage[key];
		return typeof value === 'object' && value ? value : { used: value ?? 0, limit: plan.quotas[key] };
	}
	function format(value: number) { return new Intl.NumberFormat(isId ? 'id-ID' : 'en-US',{maximumFractionDigits:1}).format(value); }
	function date(value: string) { return new Intl.DateTimeFormat(isId ? 'id-ID' : 'en-GB',{dateStyle:'long',timeZone:'Asia/Jakarta'}).format(new Date(value)); }
	const errors = {
		provider_unavailable: localized('Pembayaran belum terhubung. Paket Anda tetap aktif.', 'Payments are unavailable. Your present plan remains active.'),
		forbidden: localized('Hanya pengelola organisasi yang dapat mengubah paket.', 'Only an organisation administrator can change the plan.'),
		quota_exceeded: localized('Pemakaian saat ini melebihi batas paket yang dipilih.', 'Current usage exceeds the selected plan limit.'),
		default: localized('Perubahan paket belum tersimpan. Periksa pilihan lalu coba kembali.', 'The plan change could not be saved. Check the selection and try again.')
	};
  const simulated = $derived(Boolean(data.session?.user.guest));
  let returnTo = $state('/cases');
  let systemDark = $state(false);
  const theme = $derived(data.session?.prefs.theme === 'system' ? (systemDark ? 'night' : 'paper') : data.session?.prefs.theme ?? 'paper');
  onMount(() => {
    const mode = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {systemDark = mode.matches;};
    sync();
    mode.addEventListener('change', sync);
    return () => mode.removeEventListener('change', sync);
  });
  afterNavigate(({from}) => {
    if (from?.url.origin === location.origin && from.url.pathname !== '/billing') returnTo = from.url.pathname + from.url.search + from.url.hash;
  });
  const amount = (item: Plan, cycle: BillingCycle) => cycle === 'yearly' ? item.yearlyPerMonth : item.monthly;
  function rate(item: Plan, cycle: BillingCycle) {
    const value = amount(item,cycle);
    return value === null ? (isId ? 'Khusus' : 'Custom') : currency(value,data.lang);
  }
  const monthly = (key: QuotaId) => key === 'hours' || key === 'questions';
  function unit(item: Plan) {
    if (!item.monthly) return item.contract ? (isId ? 'sesuai kontrak' : 'by arrangement') : '';
    return item.perUser ? (isId ? 'per pengguna per bulan' : 'per user per month') : (isId ? 'per bulan' : 'per month');
  }
</script>

<svelte:head><title>{isId ? 'Paket & tagihan' : 'Plans & billing'} · Jude</title><meta name="robots" content="noindex"/></svelte:head>
<div class="billing-page" data-theme={theme}>
  <a class="pub-skip" href="#billing-main">{isId ? 'Lewati ke isi' : 'Skip to content'}</a>
  <header class="bar-top">
    <Wordmark home="/cases"/>
    <a class="back" href={returnTo}><ArrowLeft size={16}/>{isId ? 'Kembali' : 'Back'}</a>
    <span class="billing-tag">{simulated ? (isId ? 'Tagihan simulasi' : 'Simulated billing') : (isId ? 'Tagihan organisasi' : 'Organisation billing')}</span>
  </header>
  <main class="billing" id="billing-main" tabindex="-1">
    <header class="page-head">
      <h1>{isId ? 'Paket & tagihan' : 'Plans & billing'}</h1>
      <p>{isId ? 'Paket akun Anda, kuota bulan ini, dan paket yang tersedia.' : 'Your account plan, this month’s usage and the available plans.'}
        {simulated ? (isId ? 'Tagihan simulasi dengan harga contoh.' : 'This example workspace uses simulated billing.') : (isId ? 'Harga contoh dalam rupiah.' : 'Example prices in Indonesian rupiah.')}</p>
    </header>
    {#if form?.kind === 'plan'}<p class="feedback" class:error={!form.ok} role="status">
      {form.ok ? (isId ? 'Paket organisasi telah diperbarui.' : 'The organisation’s plan has been updated.') : (errors[form.error as keyof typeof errors] ?? errors.default)[data.lang]}
    </p>{/if}
    <section class="current sheen-host" aria-label={isId ? 'Paket Anda' : 'Your plan'}>
      <PlanPlate {plan} lang={data.lang} size="lg"/>
      <div class="current-text">
        <h2>{isId ? 'Paket Anda' : 'Your plan'}</h2>
        <p class="price"><strong>{rate(plan,data.account.cycle)}</strong> {unit(plan)}</p>
        {#if data.account.status === 'trialing' && data.account.trialEndsAt}<p>{isId ? 'Uji coba berakhir' : 'Trial ends'} {date(data.account.trialEndsAt)}</p>
        {:else if plan.id === 'basic'}<p>{isId ? 'Paket gratis' : 'Free plan'}</p>
        {:else}<p>{data.account.cycle === 'yearly' ? (isId ? 'Siklus tahunan' : 'Yearly billing cycle') : (isId ? 'Siklus bulanan' : 'Monthly billing cycle')}</p>{/if}
        <p class="method"><CreditCard size={14}/>{simulated ? (isId ? 'Metode pembayaran simulasi' : 'Simulated payment method') : (isId ? 'Pembayaran belum diaktifkan' : 'Payments are not enabled')}</p>
      </div>
    </section>
    <section class="block usage">
      <div><h2>{isId ? 'Kuota bulan ini' : 'This month’s quotas'}</h2>
        <p>{#if data.account.resetsOn}{isId ? 'Kuota bulanan diatur ulang' : 'Monthly quotas reset on'} {date(data.account.resetsOn)}. {/if}{isId ? 'Pemakaian dihitung dari semua perkara di organisasi ini.' : 'Usage is counted across your organisation’s cases.'}</p>
      </div>
      <ul class="meters">
        {#each quotaOrder as key}
          {@const metric = quota(key)}
          {@const pct = metric.limit ? Math.round(100 * metric.used / metric.limit) : 0}
          <li class="meter">
            <div class="meter-head"><b>{quotaNames[key][data.lang]}</b><span><strong>{format(metric.used)}</strong> / {metric.limit === null ? '∞' : format(metric.limit)}</span></div>
            {#if metric.limit !== null && metric.limit > 0}<progress aria-label={quotaNames[key][data.lang]} class:near={key !== 'seats' && pct >= 80} max={metric.limit} value={Math.min(metric.used,metric.limit)}></progress>
            {:else}<div class="bar" class:unlimited={metric.limit === null} aria-hidden="true"></div>{/if}
            <div class="facts">
              {#if metric.limit === null}{isId ? 'Tanpa batas' : 'Unlimited'}
              {:else if metric.used > metric.limit}{isId ? 'Melebihi kuota sebesar' : 'Over quota by'} {format(metric.used-metric.limit)}
              {:else if !metric.limit}{isId ? 'Di luar paket' : 'Outside this plan'}
              {:else}{isId ? 'Sisa' : 'Remaining'} {format(metric.limit-metric.used)} · {pct}% {isId ? 'terpakai' : 'used'}{/if}
              {#if monthly(key) && data.account.resetsOn}<span>{isId ? 'Diatur ulang' : 'Resets'} {date(data.account.resetsOn)}</span>{/if}
            </div>
            <p>{quotaHelp[key][data.lang]}</p>
          </li>
        {/each}
      </ul>
    </section>
    <section class="block" id="plans">
      <div class="switch-head"><h2>{isId ? 'Pilih paket' : 'Choose a plan'}</h2><CyclePicker lang={data.lang} cycle={data.cycle}/></div>
      <div class="plans">
        {#each data.plans as item (item.id)}
          {@const selected = item.id === data.account.planId && data.cycle === data.account.cycle}
          <article class="plan-card sheen-host" id={'plan-'+item.id} class:selected aria-label={item.name[data.lang]}>
            {#if selected || item.contract}<span class="ribbon">{selected ? (isId ? 'Paket aktif' : 'Current plan') : (isId ? 'Terlengkap' : 'Full service')}</span>{/if}
            <PlanPlate plan={item} lang={data.lang}/>
            <p class="tagline">{item.tagline[data.lang]}</p>
            <p class="price"><strong>{rate(item,data.cycle)}</strong> {unit(item)}</p>
            <ul class="limits">
              {#each quotaOrder as key}<li><span>{quotaNames[key][data.lang]}</span><b>{#if item.quotas[key] === null}<Unlimited size={15} aria-label={isId ? 'Tanpa batas' : 'Unlimited'}/>{:else}{format(item.quotas[key]!)}{/if}</b></li>{/each}
            </ul>
            <ul class="benefits">{#each item.bullets as feature}<li><Check size={14}/>{feature[data.lang]}</li>{/each}</ul>
            {#if item.contract && !selected}
              <a class="button" href={'?cycle='+data.cycle+'&contact=1'} onclick={(e)=>{if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {e.preventDefault(); contactForm.open();}}}>{isId ? 'Hubungi tim' : 'Contact team'}</a>
            {:else}
              <form method="POST" action="?/plan" use:enhance>
                <input type="hidden" name="planId" value={item.id}/><input type="hidden" name="cycle" value={data.cycle}/>
                <button class="button" class:primary={item.tier > plan.tier} disabled={selected}>
                  {selected ? (isId ? 'Paket aktif' : 'Current plan') : (isId ? 'Pilih ' : 'Choose ') + item.name[data.lang]}
                </button>
              </form>
            {/if}
          </article>
        {/each}
      </div>
      <p>{isId ? 'Harga contoh dalam rupiah. Uji coba dan peralihan paket mengikuti status akun Anda.' : 'Example prices in rupiah. Trial and plan changes follow the status of your account.'}</p>
    </section>
  </main>
  <SalesContact bind:this={contactForm} lang={data.lang} initial={data.showContact} result={form?.kind === 'sales' ? form : undefined} profile={data.session && !data.session.user.guest ? data.session.user : null}/>
</div>
<style>
  .billing-page { --pub-body:var(--sans); --pub-display:var(--display); --pub-paper:var(--paper); --pub-ink:var(--ink); container:billing / inline-size; background:var(--paper); color:var(--ink); min-height:100dvh; }
  .bar-top { position:sticky; z-index:10; top:0; display:flex; gap:12px; align-items:center; height:56px; padding:0 clamp(16px,3vw,36px); background:color-mix(in srgb,var(--paper) 85%,transparent); backdrop-filter:saturate(1.7) blur(20px); border-bottom:1px solid var(--line); }
  .bar-top :global(.wordmark) { font-size:26px; margin-right:6px; }
  .back { display:inline-flex; gap:8px; align-items:center; min-height:40px; padding:0 12px; border-radius:7px; font-size:13px; text-decoration:none; }
  .back:hover { background:var(--wash); }
  .billing-tag,.ribbon { font:600 11px/1.5 var(--sans); color:var(--sand-ink,#5b4520); background:var(--sand,#f3ead8); padding:3px 8px; border-radius:4px; }
  .billing-tag { margin-left:auto; }
  .billing { display:grid; gap:36px; max-width:1240px; margin:auto; padding:clamp(24px,3vw,40px) clamp(16px,3.4vw,40px) 64px; }
  .page-head h1 { font:400 clamp(31px,3vw,40px)/1.12 var(--display); letter-spacing:-.03em; }
  .page-head p { font-size:15px; color:var(--muted); max-width:68ch; margin-top:8px; }
  .current { min-height:161px; display:flex; flex-wrap:wrap; align-items:center; gap:18px 32px; padding:24px 26px; border:1px solid transparent;
    background:linear-gradient(var(--surface),var(--surface)) padding-box, linear-gradient(120deg,#c29a55,#315f45 42%,#1d392a 75%,#bf9554) border-box; border-radius:12px; }
  .current-text { display:grid; gap:4px; }
  .current-text h2 { font:600 13px/1.5 var(--sans); color:var(--muted); }
  .current-text p,.block > p,.block > div:first-child > p { font-size:13px; color:var(--muted); }
  .price { display:flex; flex-wrap:wrap; align-items:baseline; gap:6px; color:var(--muted); font-size:13px; }
  .price strong { font:400 26px/1.3 var(--display); color:var(--ink); }
  .method { display:flex; align-items:center; gap:6px; }
  .block { display:grid; gap:12px; }
  .block h2 { font:400 24px/1.25 var(--display); }
  .block > div:first-child > p { margin-top:6px; }
  .meters,.limits,.benefits { padding:0; margin:0; list-style:none; }
  .meters { display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr)); }
  .meter { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px; display:grid; align-content:start; gap:8px; }
  .meter-head,.limits li { display:flex; gap:10px; justify-content:space-between; align-items:baseline; }
  .meter-head { min-height:38px; align-items:flex-start; }
  .meter-head b { font-size:13px; font-weight:600; }
  .meter-head span { white-space:nowrap; color:var(--muted); font-size:12.5px; }
  .meter-head strong { font:600 17px/1.3 var(--sans); color:var(--ink); }
  .meter-head,.facts,.limits b { font-variant-numeric:tabular-nums; }
  progress,.bar { width:100%; height:6px; border:0; appearance:none; border-radius:100px; overflow:hidden; background:var(--sunken,#ebeae1); }
  progress::-webkit-progress-bar { background:var(--sunken,#ebeae1); }
  progress::-webkit-progress-value { background:var(--ink); border-radius:100px; transition:width var(--dur) var(--ease-out); }
  progress::-moz-progress-bar { background:var(--ink); border-radius:100px; }
  progress.near::-webkit-progress-value { background:#a66e27; }
  progress.near::-moz-progress-bar { background:#a66e27; }
  .bar.unlimited { background:repeating-linear-gradient(90deg,#5f8a69 0 6px,transparent 6px 10px); }
  .facts,.meter p { font-size:12.5px; line-height:1.5; }
  .facts span { display:block; margin-top:3px; color:var(--muted); }
  .meter p { color:var(--muted); }
  .switch-head { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:12px; }
  .switch-head :global(.cycle-switch) { border-color:var(--line-strong); background:var(--sunken); }
  .switch-head :global(.cycle-switch a) { color:var(--ink); font:600 13px/1.35 var(--sans); }
  .switch-head :global(.cycle-switch a[aria-current]) { color:var(--ink-strong); background:var(--surface); }
  .plans { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr)); align-items:stretch; gap:16px; }
  .plan-card { display:grid; grid-template-rows:auto auto auto 1fr auto auto; gap:14px; position:relative; padding:20px 18px 18px; background:var(--surface); border:1px solid var(--line); border-radius:12px; }
  .plan-card.selected { border-color:#8fae96; }
  .ribbon { position:absolute; z-index:1; top:-9px; right:14px; }
  .tagline,.limits,.benefits { font-size:13px; line-height:1.5; }
  .tagline,.limits { color:var(--muted); }
  .limits li { padding-block:6px; border-bottom:1px solid var(--line); }
  .limits b { color:var(--ink); }
  .benefits { display:grid; gap:6px; }
  .benefits li { display:flex; align-items:baseline; gap:7px; }
  .plan-card .button { width:100%; }
  .feedback { padding:12px 16px; background:var(--wash); border-radius:8px; }
  .feedback.error { color:var(--accent); }
  @container billing (max-width:640px) {
    .billing { gap:28px; }
    .current { padding:20px 18px; }
    .current-text { width:100%; }
    .current :global(.plate.lg) { min-width:min(100%,260px); }
  }
</style>
