<script lang="ts">
	import { page } from '$app/state';
	import { type Language, type BillingCycle } from './plans';
	let { lang, cycle }: { lang: Language; cycle: BillingCycle } = $props();
	const options: BillingCycle[] = ['monthly','yearly'];
	function href(to: BillingCycle) {
		const query = new URLSearchParams(page.url.search);
		query.delete('contact'); query.delete('/plan'); query.delete('/contact'); query.set('cycle',to);
		return page.url.pathname + '?' + query.toString() + '#plans';
	}
</script>
<nav class="cycle-switch" aria-label={lang === 'id' ? 'Siklus tagihan' : 'Billing cycle'}>
	{#each options as option}<a href={href(option)} aria-current={option === cycle ? 'true' : undefined}>{option === 'yearly' ? (lang === 'id' ? 'Tahunan' : 'Yearly') : (lang === 'id' ? 'Bulanan' : 'Monthly')}</a>{/each}
</nav>
<style>
	.cycle-switch { display:inline-flex; align-items:center; padding:3px; border:1px solid #b5beac; border-radius:6px; background:#e9ecdf; color:#364a37; }
	.cycle-switch a { min-height:42px; display:grid; place-items:center; padding:6px 18px; border-radius:3px; color:inherit; text-decoration:none; font:600 .86rem/1.3 var(--pub-body); }
	.cycle-switch a[aria-current] { background:#fffcf2; color:#213b2b; box-shadow:0 1px 4px #3445312b; }
</style>
