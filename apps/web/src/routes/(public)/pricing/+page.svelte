<script lang="ts">
	import type { PageProps } from './$types';
	import CyclePicker from '$lib/public/CyclePicker.svelte';
	import PlanList from '$lib/public/PlanList.svelte';
	import SalesContact from '$lib/public/SalesContact.svelte';
	import Icon from '$lib/public/Icon.svelte';
	import { featureNames, localized, quotaNames, quotaOrder } from '@jude/core/plans';
	let { data, form }: PageProps = $props();
	let isId = $derived(data.lang === 'id');
	let contactForm: SalesContact;
	let chosen = $derived(data.target || data.session?.plan.id || 'pro');
	const features = ['live_transcription','response_suggestions','jude_export','team_sharing','case_roles'] as const;
	const faq = [
		{ q: localized('Bagaimana uji coba bekerja?', 'How does the trial work?'), a: localized('Uji coba Advokat Pro atau Firma berlangsung 14 hari tanpa kartu. Setelah itu akun kembali ke Dasar, kecuali Anda memilih paket berbayar.', 'The Advocate Pro or Firm trial lasts 14 days without a card. The account then returns to Basic unless you choose a paid plan.') },
		{ q: localized('Apa yang dihitung sebagai jam transkripsi?', 'What counts towards transcription hours?'), a: localized('Durasi sidang yang direkam dan audio yang diunggah. Transkrip teks yang diimpor tidak memakai jam transkripsi.', 'Recorded hearings and uploaded audio count by duration. Imported text transcripts use no transcription hours.') },
		{ q: localized('Apakah berkas saya tetap tersimpan saat berganti paket?', 'Do I keep my files if I change plans?'), a: localized('Berkas yang ada tetap tersimpan. Bila pemakaian melampaui batas baru, kurangi pemakaian sebelum menambah materi baru.', 'Existing files are kept. If usage exceeds a new limit, reduce usage before adding more material.') },
		{ q: localized('Apakah kutipan ikut diterjemahkan?', 'Are quotations translated as well?'), a: localized('Antarmuka tersedia dalam Bahasa Indonesia dan Inggris. Dokumen asli dan keterangan di sidang selalu ditampilkan dalam bahasa asalnya.', 'The interface is available in Indonesian and English. Original documents and testimony are always shown in the language of the record.') }
	];
</script>
<svelte:head><title>{isId ? 'Paket dan harga' : 'Plans and pricing'} · Jude</title><meta name="description" content={isId ? 'Bandingkan paket dan kuota ruang kerja Jude.' : 'Compare plans and quotas for the Jude case workspace.'}/></svelte:head>
<section class="pricing-cover"><div class="pub-frame pricing-intro"><h1>{isId ? 'Ruang untuk setiap perkara.' : 'Room for every case.'}</h1><p>{isId ? 'Pilih kapasitas ruang kerja yang sesuai. Kutipan dan sumber tetap berdampingan di setiap paket.' : 'Choose the capacity your practice needs. Quotations and their sources stay side by side on every plan.'}</p></div></section>
<section class="pub-frame plans" id="plans">
	<div class="price-bar"><div><h2>{isId ? 'Paket ruang kerja' : 'Workspace plans'}</h2><p>{isId ? 'Harga contoh dalam rupiah. Simulasi ini tidak memproses pembayaran.' : 'Example prices in rupiah. This simulation processes no payments.'}</p></div><CyclePicker lang={data.lang} cycle={data.cycle}/></div>
	<PlanList plans={data.plans} lang={data.lang} cycle={data.cycle} signedIn={Boolean(data.session && !data.session.user.guest)} selected={data.target} contact={() => contactForm.open()}/>
</section>
<div class="pub-frame compare">
	<h2>{isId ? 'Bandingkan kapasitas.' : 'Compare capacity.'}</h2>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users scroll the wide comparison inside this region.) -->
	<div class="table-wrap" role="region" aria-label={isId ? 'Perbandingan paket' : 'Plan comparison'} tabindex="0"><table>
		<caption class="visually-hidden">{isId ? 'Fitur dan batas menurut paket' : 'Feature and quota comparison by plan'}</caption>
		<thead><tr><th scope="col">{isId ? 'Per paket' : 'Per plan'}</th>{#each data.plans as plan}<th scope="col" class:chosen={chosen === plan.id}>{plan.name[data.lang]}</th>{/each}</tr></thead>
		<tbody>{#each quotaOrder as key}<tr><th scope="row">{quotaNames[key][data.lang]}</th>{#each data.plans as plan}<td class:chosen={chosen === plan.id}>{plan.quotas[key] === null ? (isId ? 'Tanpa batas' : 'Unlimited') : new Intl.NumberFormat(isId ? 'id-ID' : 'en-US').format(plan.quotas[key]!)}</td>{/each}</tr>{/each}
		{#each features as key}<tr><th scope="row">{featureNames[key][data.lang]}</th>{#each data.plans as plan}<td class:chosen={chosen === plan.id}>{#if plan.features.includes(key)}<Icon name="check" size={17}/><span class="visually-hidden">{isId ? 'Termasuk' : 'Included'}</span>{:else}<span aria-hidden="true">—</span><span class="visually-hidden">{isId ? 'Di luar paket' : 'Not included'}</span>{/if}</td>{/each}</tr>{/each}</tbody>
	</table></div>
</div>
<section class="pub-frame faq"><h2>{isId ? 'Tentang paket Jude.' : 'About Jude’s plans.'}</h2><div>{#each faq as row}<details name="pricing-questions"><summary>{row.q[data.lang]}<Icon name="chevron" size={18}/></summary><p>{row.a[data.lang]}</p></details>{/each}</div></section>
<SalesContact bind:this={contactForm} lang={data.lang} initial={data.showContact} result={form} profile={data.session && !data.session.user.guest ? data.session.user : null}/>
<style>
	.pricing-cover { background:#17382c url('/public/case-cloth.webp') center/1200px; background-blend-mode:soft-light; color:#f9f2e3; }
	.pricing-intro { padding-block:clamp(42px,6.7vw,100px); display:grid; grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr); gap:clamp(36px,9vw,140px); align-items:end; }
	.pricing-intro h1 { max-width:12ch; font-size:clamp(3.5rem,6.8vw,6rem); }
	.pricing-intro p { color:#d9e3d6; font-size:clamp(1rem,1.4vw,1.2rem); line-height:1.6; max-width:42ch; }
	.plans { padding-block:clamp(44px,6vw,78px); }
	.price-bar { display:flex; justify-content:space-between; align-items:center; gap:22px; margin-bottom:26px; }
	.price-bar h2,.compare h2,.faq h2 { font-size:clamp(2.3rem,3.8vw,3.8rem); }
	.price-bar p,.faq p { margin-top:11px; color:#526052; font-size:.9rem; line-height:1.65; }
	.compare { padding-block:14px 50px; }
	.table-wrap { position:relative; margin-top:25px; }
	table { border-collapse:separate; border-spacing:0; width:100%; font:.87rem/1.4 var(--pub-record); }
	th,td { text-align:center; padding:13px 10px; border-bottom:1px solid #d2d4c8; }
	th:first-child { text-align:left; font-weight:400; }
	thead th { background:#e8ebdf; color:#2d472f; position:sticky; top:0; z-index:1; font:600 .88rem/1.4 var(--pub-body); }
	.chosen { background:#ece7d8; }
	thead .chosen { background:#e5dbc0; }
	.visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
	.faq { padding-block:45px 75px; display:grid; grid-template-columns:.8fr 1.2fr; gap:50px; }
	.faq details { border-bottom:1px solid #cbd0c1; }
	.faq details:first-child { border-top:1px solid #cbd0c1; }
	.faq summary { list-style:none; min-height:60px; display:flex; justify-content:space-between; align-items:center; gap:18px; cursor:pointer; font-weight:600; }
	.faq summary::-webkit-details-marker { display:none; }
	.faq p { margin:0 0 17px; }
	.faq details[open] :global(svg) { transform:rotate(180deg); }
	@media(max-width:760px){.pricing-intro,.faq{grid-template-columns:1fr;gap:20px;}.price-bar{align-items:start;flex-direction:column;gap:16px;}.table-wrap{overflow-x:auto;}table{min-width:650px;}th:first-child{position:sticky;left:0;background:#f7f4e9;max-width:140px;}thead th:first-child{z-index:2;} .faq{padding-block:30px 55px;}}
</style>
