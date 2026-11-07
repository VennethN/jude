<script lang="ts">
	import Icon from './Icon.svelte';
	import { currency, type Plan, type Language, type BillingCycle } from './plans';
	let { plans, lang, cycle, signedIn, billing = false, current, selected, contact }: { plans: Plan[]; lang: Language; cycle: BillingCycle; signedIn: boolean; billing?: boolean; current?: string; selected?: string | null; contact?: () => void } = $props();
	let isId = $derived(lang === 'id');
</script>
<div class="plan-grid">
	{#each plans as plan}
		<article class:pro={plan.id === 'pro'} class:selected={selected === plan.id} id={'plan-' + plan.id}>
			<header class={'tier-' + plan.tier}><h3>{plan.name[lang]}</h3>{#if plan.id === 'pro'}<span>{isId ? 'Untuk advokat' : 'For advocates'}</span>{/if}</header>
			<div class="plan-body"><p class="tagline">{plan.tagline[lang]}</p>
				<div class="amount"><b>{plan.monthly === null ? (isId ? 'Sesuai kebutuhan' : 'By arrangement') : currency(cycle === 'yearly' ? plan.yearlyPerMonth ?? 0 : plan.monthly, lang)}</b>
					<small>{plan.contract ? (isId ? 'Kontrak tahunan' : 'Annual contract') : plan.monthly === 0 ? (isId ? 'Tanpa biaya' : 'Free plan') : plan.perUser ? (isId ? 'per pengguna per bulan' : 'per user per month') : (isId ? 'per bulan' : 'per month')}</small></div>
				<p class="total">{#if cycle === 'yearly' && plan.yearly && plan.yearlySaving}{currency(plan.yearly,lang)} {isId ? 'per tahun' : 'per year'}{plan.perUser ? (isId ? ' per pengguna' : ' per user') : ''}. {isId ? 'Hemat' : 'Save'} {currency(plan.yearlySaving,lang)}.{:else if plan.trial}{isId ? 'Uji coba 14 hari tanpa kartu.' : '14-day trial without a card.'}{:else if plan.contract}{isId ? 'Bahas kapasitas bersama tim Jude.' : 'Discuss capacity with the Jude team.'}{:else}{isId ? 'Mulai dengan dua perkara aktif.' : 'Start with two active cases.'}{/if}</p>
				<ul>{#each plan.bullets as benefit}<li><Icon name="check" size={15}/>{benefit[lang]}</li>{/each}</ul>
				{#if plan.contract}
					<a class="pub-button quiet" href={'?cycle=' + cycle + '&contact=1#partner'} onclick={(e) => { if (contact && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); contact(); } }}>{isId ? 'Hubungi tim' : 'Contact team'}<Icon name="forward" size={15}/></a>
				{:else if billing}
					<form method="POST" action="?/plan"><input type="hidden" name="planId" value={plan.id}/><input type="hidden" name="cycle" value={cycle}/>
						<button class:quiet={plan.id !== 'pro'} class="pub-button" disabled={current === plan.id}>{current === plan.id ? (isId ? 'Paket aktif' : 'Current plan') : (isId ? 'Pilih ' : 'Choose ') + plan.name[lang]}</button></form>
				{:else}
					<a class:quiet={plan.id !== 'pro'} class="pub-button" href={(signedIn ? '/billing' : '/signup') + '?plan=' + plan.id + '&cycle=' + cycle}>{plan.trial ? (isId ? 'Coba 14 hari' : 'Try for 14 days') : (isId ? 'Pilih Dasar' : 'Choose Basic')}<Icon name="arrow" size={15}/></a>
				{/if}
			</div>
		</article>
	{/each}
</div>
<style>
	.plan-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
	article { display:flex; flex-direction:column; border:1px solid #c8ccbd; border-radius:5px; background:#fffdf4; overflow:hidden; scroll-margin-top:20px; }
	article.pro { border-color:#506d53; }
	article.selected { outline:2px solid #a47d41; outline-offset:2px; }
	header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; min-height:69px; padding:14px 18px; gap:5px; }
	.tier-0 { background:#e4e5d7; color:#334839; }
	.tier-1 { background:#31533d url('/public/case-cloth.webp') center/700px; color:#fbf4df; background-blend-mode:soft-light; }
	.tier-2 { background:#d5bd84; color:#3f371f; }
	.tier-3 { background:#d7dedc; color:#34464a; }
	header h3 { font-size:clamp(1.7rem,2.7vw,2.3rem); }
	header span { font:.71rem/1.3 var(--pub-body); }
	.plan-body { padding:19px clamp(14px,1.7vw,25px) 20px; display:flex; flex:1; flex-direction:column; }
	.tagline { min-height:4.6em; font-size:.89rem; line-height:1.5; color:#4e5d50; }
	.amount { margin:18px 0 8px; }
	.amount b { font:400 clamp(1.75rem,2.65vw,2.65rem)/1.05 var(--pub-display); letter-spacing:-.023em; display:block; overflow-wrap:break-word; }
	.amount small, .total { color:#566454; font-size:.77rem; line-height:1.5; }
	.total { min-height:4.4em; }
	ul { list-style:none; margin:13px 0 22px; padding:15px 0 0; border-top:1px solid #d4d8ca; flex:1; }
	li { display:flex; gap:7px; align-items:flex-start; font-size:.84rem; margin-bottom:9px; line-height:1.45; }
	li :global(svg) { flex:none; margin-top:2px; color:#456443; }
	.pub-button, .plan-body form { width:100%; }
	@media(max-width:1000px){.plan-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;}.tagline{min-height:3em;}.total{min-height:2.8em;}}
	@media(max-width:540px){.plan-grid{grid-template-columns:1fr;}.tagline,.total{min-height:0;}.amount{margin:14px 0 5px;}.amount b{font-size:2.5rem;} ul{margin-bottom:16px;}header{min-height:58px;}}
</style>
