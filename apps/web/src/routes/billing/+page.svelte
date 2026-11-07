<script lang="ts">
	import '$lib/public/public.css';
	import CyclePicker from '$lib/public/CyclePicker.svelte';
	import PlanList from '$lib/public/PlanList.svelte';
	import SalesContact from '$lib/public/SalesContact.svelte';
	import Wordmark from '$lib/public/Wordmark.svelte';
	import Icon from '$lib/public/Icon.svelte';
	import { planById, quotaOrder, quotaNames, quotaHelp, localized, type QuotaId } from '@jude/core/plans';
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
</script>
<svelte:head><title>{isId ? 'Paket dan tagihan' : 'Plans and billing'} · Jude</title><meta name="robots" content="noindex"/></svelte:head>
<div class="public-world billing">
	<a class="pub-skip" href="#billing-main">{isId ? 'Lewati ke isi' : 'Skip to content'}</a>
	<header class="billing-header"><div class="pub-frame"><Wordmark home="/cases"/><a href="/cases"><Icon name="back" size={16}/>{isId ? 'Kembali ke perkara' : 'Back to cases'}</a></div></header>
	<main class="pub-frame" id="billing-main" tabindex="-1">
		<h1>{isId ? 'Paket dan tagihan.' : 'Plans and billing.'}</h1>
		<p class="lede">{isId ? 'Paket organisasi, pemakaian, dan batas untuk perkara Anda.' : 'Your organisation’s plan, usage and case limits.'}</p>
		{#if form?.kind === 'plan'}<p class="pub-feedback" class:error={!form.ok} role="status">{form.ok ? (isId ? 'Paket organisasi telah diperbarui.' : 'The organisation’s plan has been updated.') : (errors[form.error as keyof typeof errors] ?? errors.default)[data.lang]}</p>{/if}
		<section class="current">
			<div><span>{isId ? 'Paket aktif' : 'Current plan'}</span><h2>{plan.name[data.lang]}</h2></div>
			<p>{#if data.account.status === 'trialing' && data.account.trialEndsAt}{isId ? 'Uji coba berakhir' : 'Trial ends'} {date(data.account.trialEndsAt)}.{:else if plan.id === 'basic'}{isId ? 'Paket tanpa biaya.' : 'Free workspace plan.'}{:else}{isId ? 'Paket organisasi aktif.' : 'Organisation plan is active.'}{/if}<br/>{data.session?.user.guest ? (isId ? 'Simulasi perkara contoh. Tidak ada pembayaran.' : 'Example-case simulation. No payments are taken.') : (isId ? 'Harga contoh. Pembayaran belum diaktifkan.' : 'Example prices. Payment processing is unavailable.')}</p>
		</section>
		<section class="usage"><h2>{isId ? 'Pemakaian ruang kerja' : 'Workspace usage'}</h2>{#if data.account.resetsOn}<p>{isId ? 'Kuota bulanan dimulai kembali pada' : 'Monthly quotas reset on'} {date(data.account.resetsOn)}.</p>{/if}
			<div class="meters">{#each quotaOrder as key}{@const metric = quota(key)}<div class="meter">
				<div class="meter-head"><b>{quotaNames[key][data.lang]}</b><span>{format(metric.used)} / {metric.limit === null ? (isId ? 'Tanpa batas' : 'Unlimited') : format(metric.limit)}</span></div>
				{#if metric.limit !== null && metric.limit > 0}<progress aria-label={quotaNames[key][data.lang]} class:near={metric.used/metric.limit >= .8} max={metric.limit} value={Math.min(metric.used,metric.limit)}></progress>{/if}
				<small>{quotaHelp[key][data.lang]}</small>
			</div>{/each}</div>
		</section>
		<section id="plans" class="switch"><div class="switch-head"><h2>{isId ? 'Pilihan paket' : 'Plan options'}</h2><CyclePicker lang={data.lang} cycle={data.cycle}/></div>
			<PlanList plans={data.plans} lang={data.lang} cycle={data.cycle} signedIn billing current={data.account.cycle === data.cycle ? data.account.planId : undefined} selected={data.target} contact={() => contactForm.open()}/>
		</section>
	</main>
	<SalesContact bind:this={contactForm} lang={data.lang} initial={data.showContact} result={form?.kind === 'sales' ? form : undefined} profile={data.session && !data.session.user.guest ? data.session.user : null}/>
</div>
<style>
	.billing-header { background:#18372a; color:#f8f1e2; }
	.billing-header > div { display:flex; align-items:center; justify-content:space-between; min-height:74px; }
	.billing-header a { display:inline-flex; align-items:center; gap:8px; min-height:44px; color:inherit; font-size:.88rem; }
	main { padding-block:clamp(40px,5.5vw,76px); }
	main h1 { font-size:clamp(3rem,5.3vw,5rem); }
	.lede { color:#50604f; margin:13px 0 30px; }
	.current { display:flex; align-items:center; justify-content:space-between; gap:26px; padding:26px clamp(20px,3.5vw,45px); background:#244635 url('/public/case-cloth.webp') center/900px; color:#f8f0dc; background-blend-mode:soft-light; border-radius:5px; }
	.current span { font-size:.85rem; color:#d3ddc8; }.current h2 { font-size:clamp(2.3rem,4vw,3.9rem); margin-top:4px; }.current p{color:#dae2d1;font-size:.9rem;}
	.usage,.switch { margin-top:clamp(42px,5vw,73px); }.usage h2,.switch h2 {font-size:clamp(2rem,3.5vw,3rem);}
	.usage > p { color:#586553; margin-top:10px; font-size:.88rem; }
	.meters { margin-top:20px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:20px 30px; }
	.meter { padding-top:13px; border-top:1px solid #cad1c2; }
	.meter-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; font-size:.84rem; }.meter-head span{font-variant-numeric:tabular-nums;color:#475e48;}
	progress { height:5px; width:100%; appearance:none; border:0; background:#dfe5d8; color:#456a4b; }
	progress::-webkit-progress-bar {background:#dfe5d8;}progress::-webkit-progress-value {background:#456a4b;}progress::-moz-progress-bar{background:#456a4b;}progress.near::-webkit-progress-value{background:#9d7639;}progress.near::-moz-progress-bar{background:#9d7639;}
	.meter small {display:block;color:#586553;font-size:.76rem;margin-top:6px;}
	.switch-head {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:15px;margin-bottom:22px;}
	.pub-feedback { margin:0 0 18px; }
	@media(max-width:900px){.meters{grid-template-columns:repeat(2,minmax(0,1fr));}}@media(max-width:590px){.meters{grid-template-columns:1fr;}.current{align-items:flex-start;flex-direction:column;gap:12px;}}
</style>
