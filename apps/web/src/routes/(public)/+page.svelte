<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import CaseCover from '$lib/public/CaseCover.svelte';
	import SourceDesk from '$lib/public/SourceDesk.svelte';
	import Icon from '$lib/public/Icon.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let isId = $derived(data.lang === 'id');
	let title = $derived(isId ? 'Jude · Ruang kerja perkara untuk advokat' : 'Jude · A case workspace for advocates');
	let description = $derived(isId ? 'Ikuti keterangan saksi dan telusuri kutipan sampai ke berkas perkara aslinya.' : 'Follow witness testimony and trace a quotation back to the original case file.');
	const steps = [
		{ id: ['Kumpulkan berkas', 'Buka BAP, log, dan dokumen lain sebagaimana diajukan. Setiap kutipan menyimpan nomor halamannya.'], en: ['Gather the record', 'Open statements, logs and documents as filed. Each excerpt keeps its page reference.'], href: '/demo/documents', icon: 'file' },
		{ id: ['Ikuti sidang', 'Baca transkrip menurut pembicara dan tandai baris yang perlu Anda dengar kembali.'], en: ['Follow the hearing', 'Read the transcript by speaker and bookmark the lines you want to revisit.'], href: '/demo/hearings/h2', icon: 'mic' },
		{ id: ['Periksa temuan', 'Bandingkan dua kutipan dan simpan pertanyaan yang ingin Anda ajukan.'], en: ['Review the finding', 'Compare the passages and save the question you want to ask.'], href: '/demo/findings/f1', icon: 'link' }
	] as const;
	onMount(() => {
		const section = page.url.searchParams.get('to');
		if (section && ['lp-how','lp-approach','lp-source','lp-close'].includes(section)) {
			document.getElementById(section)?.focus({ preventScroll: true });
			document.getElementById(section)?.scrollIntoView();
		}
	});
</script>
<svelte:head>
	<title>{title}</title><meta name="description" content={description}/><meta property="og:title" content={title}/><meta property="og:description" content={description}/><meta property="og:type" content="website"/><meta property="og:image" content={new URL('/public/case-preview.jpg', page.url.origin).href}/><meta name="twitter:card" content="summary_large_image"/>
</svelte:head>
<section class="cover">
	<div class="pub-frame cover-spread">
		<div class="opening">
			<h1>{isId ? 'Ikuti keterangan.' : 'Follow testimony.'}<br/>{isId ? 'Telusuri sumbernya.' : 'Trace its source.'}</h1>
			<p>{isId ? 'Jude menyandingkan ucapan di ruang sidang dengan dokumen perkara. Baca kutipan persisnya sebelum menyusun pertanyaan berikutnya.' : 'Jude places what was said in court beside what was filed. Read the exact words before deciding what to ask next.'}</p>
			<div class="hero-actions"><a class="pub-button cream" href="/demo">{isId ? 'Coba perkara contoh' : 'Try the example case'} <Icon name="arrow"/></a><a class="pub-textlink" href="#lp-source">{isId ? 'Lihat cara kerja' : 'See how it works'} <Icon name="chevron" size={15}/></a></div>
		</div>
		<CaseCover lang={data.lang}/>
	</div>
</section>
<section class="pub-frame source-section" id="lp-source" tabindex="-1">
	<div class="source-copy"><h2>{isId ? 'Setiap temuan punya sumber.' : 'Every finding has a source.'}</h2><p>{isId ? 'Di persidangan, saksi menyebut setengah sepuluh. Dalam BAP, ia menyebut sedikit lewat delapan. Buka catatan asal untuk memeriksa apakah keduanya merujuk pada peristiwa yang sama.' : 'In court, the witness recalls half past nine. Her written statement says shortly after eight. Read the records to check whether they describe the same event.'}</p><a class="pub-textlink" href="/demo/findings/f1">{isId ? 'Telusuri temuan ini' : 'Inspect this finding'} <Icon name="forward" size={15}/></a></div>
	<SourceDesk lang={data.lang}/>
</section>
<section class="workflow" id="lp-how" tabindex="-1">
	<div class="pub-frame walkthrough">
		<div><h2>{isId ? 'Dari berkas pertama hingga sidang berikutnya.' : 'From the first filing to the next hearing.'}</h2><p>{isId ? 'Jelajahi tiap tahap dalam satu perkara sintetis.' : 'Explore each step inside one synthetic case.'}</p></div>
		<ol>{#each steps as step}<li><a href={step.href}><span class="step-icon"><Icon name={step.icon} size={22}/></span><div><h3>{step[data.lang][0]}</h3><p>{step[data.lang][1]}</p></div><Icon name="forward" size={16}/></a></li>{/each}</ol>
	</div>
</section>
<section class="pub-frame approach" id="lp-approach" tabindex="-1">
	<div><h2>{isId ? 'Penilaian tetap di tangan advokat.' : 'The judgment stays with counsel.'}</h2><p>{isId ? 'Sebuah perbedaan adalah alasan untuk memeriksa konteks. Temuan mengantar Anda ke ucapan dan dokumen yang bisa Anda baca sendiri.' : 'A difference is a reason to check the context. Each finding leads back to testimony and documents you can read for yourself.'}</p></div>
	<aside><div class="question-label"><Icon name="mark" size={17}/>{isId ? 'Pertanyaan untuk saksi' : 'Question for the witness'}</div><blockquote lang="id">“Apakah waktu yang Saudari ingat adalah saat tiba di gerbang, atau saat mulai berjaga?”</blockquote><small>{isId ? 'Contoh sintetis' : 'Synthetic example'}</small></aside>
</section>
<section class="closing" id="lp-close" tabindex="-1"><div class="pub-frame close-inner"><h2>{isId ? 'Buka berkasnya.' : 'Open the case file.'}</h2><a class="pub-button cream" href="/demo">{isId ? 'Masuk ke perkara contoh' : 'Enter the example case'}<Icon name="arrow"/></a></div></section>
<style>
	.cover { color:#f8f3e4; background:#142f26 url('/public/case-cloth.webp') center/1200px auto; background-blend-mode:soft-light; overflow:hidden; }
	.cover-spread { min-height:clamp(540px,43vw,690px); display:grid; grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr); align-items:center; gap:clamp(36px,5vw,76px); padding-top:clamp(36px,5vw,74px); padding-bottom:clamp(42px,5.5vw,81px); }
	.opening h1 { color:#f9f4e8; font:400 clamp(3.2rem,5.45vw,5.75rem)/1.04 var(--pub-display); letter-spacing:-.032em; text-wrap:initial; }
	.opening > p { max-width:48ch; margin-top:24px; color:#d9e3d6; font-size:clamp(.99rem,1.22vw,1.12rem); line-height:1.65; }
	.hero-actions { display:flex; align-items:center; flex-wrap:wrap; gap:16px 26px; margin-top:32px; }
	.hero-actions .pub-textlink { color:#e2e8d9; font-size:.85rem; text-decoration-color:#98aa97; }
	.source-section, .walkthrough, .approach { display:grid; align-items:center; gap:clamp(32px,8vw,135px); padding-block:clamp(60px,8vw,116px); }
	.source-section { grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr); }
	.source-copy h2, .walkthrough h2, .approach h2 { font-size:clamp(2.65rem,4.7vw,4.8rem); }
	.source-copy p, .walkthrough > div > p, .approach p { max-width:50ch; margin-top:22px; line-height:1.72; color:#47564a; }
	.source-copy .pub-textlink { margin-top:18px; color:#35543e; }
	.workflow { background:#eae9df; border-block:1px solid #d8d9ce; }
	.walkthrough { align-items:start; grid-template-columns:minmax(0,.83fr) minmax(0,1.17fr); }
	ol { list-style:none; padding:0; margin:0; border-top:1px solid #aeb8a7; }
	li { border-bottom:1px solid #bfc6b8; }
	li a { display:grid; grid-template-columns:auto 1fr auto; align-items:start; gap:17px; color:inherit; text-decoration:none; padding:24px 0; }
	li a:hover h3 { text-decoration:underline; text-underline-offset:4px; }
	li a > :global(svg) { margin-top:10px; }
	.step-icon { width:43px; height:43px; display:grid; place-items:center; border-radius:50%; background:#d9dfd1; color:#354f3b; }
	li h3 { font-size:clamp(1.65rem,2.3vw,2.25rem); }
	li p { margin-top:7px; color:#526153; line-height:1.55; font-size:.93rem; }
	.approach { grid-template-columns:1fr 1fr; }
	.approach aside { background:#e8dece url('/public/ivory-paper.webp') center/650px; background-blend-mode:multiply; padding:clamp(24px,4.3vw,58px); color:#4b343a; }
	.question-label { display:flex; align-items:center; gap:8px; color:#6f4652; font-size:.85rem; }
	.approach blockquote { font:400 clamp(1.72rem,3vw,3rem)/1.16 var(--pub-display); margin:18px 0; }
	.approach small { color:#6e615a; font-size:max(12px,.8rem); }
	.closing { color:#fcf3df; background:#153328 url('/public/jude-case-files.webp') center 16%/cover; border-bottom:1px solid #6e887d; }
	.close-inner { display:flex; align-items:center; flex-wrap:wrap; gap:35px; padding-block:65px; }
	.close-inner h2 { font-size:clamp(2.7rem,5vw,5rem); }
	@media(max-width:900px){.cover-spread{gap:20px;grid-template-columns:.9fr 1.1fr;}.opening h1{font-size:clamp(2.9rem,5.75vw,3.4rem);}.opening > p{font-size:.96rem;}.source-section,.walkthrough,.approach{gap:30px;} }
	@media(max-width:700px){.cover-spread,.source-section,.walkthrough,.approach{grid-template-columns:1fr;}.cover-spread{padding-block:39px;gap:35px;}.opening{max-width:550px;}.opening h1{font-size:clamp(3.1rem,9.8vw,4.5rem);}.opening > p{margin-top:16px;max-width:43ch;}.hero-actions{margin-top:20px;gap:12px 19px;}.source-section,.walkthrough,.approach{padding-block:52px;}.source-copy p,.walkthrough > div > p,.approach p{margin-top:16px;}.close-inner{gap:16px;padding-block:45px;}.closing{background-position:30% 8%;}}
</style>
