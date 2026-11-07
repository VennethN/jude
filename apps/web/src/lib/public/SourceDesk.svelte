<script lang="ts">
	import type { Language } from '@jude/core/plans';
	import Icon from './Icon.svelte';
	let { lang }: { lang: Language } = $props();
	let isId = $derived(lang === 'id');
	const items = [
		{ name: ['BAP saksi', 'Witness statement'], title: 'Berita Acara Pemeriksaan Saksi', person: 'Rina Hartati', where: ['Halaman 4', 'Page 4'], prefix: 'Pada hari Sabtu tanggal 14 Maret 2026 saya tiba di gudang ', mark: 'sedikit setelah pukul 20.00 WIB', suffix: ' untuk menggantikan rekan saya, Sdr. Yusuf, yang berjaga sore.', href: '/demo/documents/d1?p=d1p4', icon: 'file' },
		{ name: ['Log akses', 'Access log'], title: 'Laporan Log Akses Gerbang', person: 'Gerbang Timur · Gudang B', where: ['Halaman 7', 'Page 7'], prefix: 'Kartu akses atas nama R. Hartati tercatat masuk di Gerbang Timur pada 14/03/2026 pukul ', mark: '20:07:41', suffix: '.', href: '/demo/documents/d3?p=d3p2', icon: 'book' },
		{ name: ['Transkrip', 'Transcript'], title: 'Pemeriksaan Saksi Rina Hartati', person: 'Rina Hartati', where: ['Sidang 2', 'Hearing 2'], prefix: 'Saya sampai di gudang jam ', mark: 'setengah sepuluh malam', suffix: ', Pak.', href: '/demo/hearings/h2?s=s208', icon: 'mic' }
	] as const;
	let selected = $state(0);
	let item = $derived(items[selected]);
	let l = $derived(isId ? 0 : 1);
</script>
<div class="desk">
	<div class="desk-tabs" aria-label={isId ? 'Pilih sumber' : 'Select source'}>
		{#each items as option,i}<button type="button" class:chosen={selected === i} aria-pressed={selected === i} onclick={() => selected = i}><Icon name={option.icon} size={17}/>{option.name[l]}</button>{/each}
	</div>
	<div class="reading" aria-live="polite">
		<header><span>{isId ? 'Contoh sintetis' : 'Synthetic example'}</span><span>{item.where[l]}</span></header>
		<div class="reading-main">
			<h3 lang="id">{item.title}</h3><p class="source-person">{item.person}</p>
			<blockquote class:testimony={selected === 2} lang="id">{item.prefix}<mark>{item.mark}</mark>{item.suffix}</blockquote>
		</div>
		<a href={item.href}>{isId ? 'Buka sumber dalam perkara' : 'Open source in case'}<Icon name="forward" size={15}/></a>
	</div>
</div>
<style>
	.desk { min-width:0; }
	.desk-tabs { display:flex; flex-wrap:wrap; gap:3px; margin:0 0 -1px; }
	.desk-tabs button { min-height:46px; display:inline-flex; gap:7px; align-items:center; border:1px solid #c6cbbd; border-bottom:0; border-radius:5px 5px 0 0; padding:8px clamp(8px,1.6vw,22px); background:#eae9df; color:#465a47; font:500 .79rem/1.25 var(--pub-body); cursor:pointer; }
	.desk-tabs .chosen { color:#fbf7e9; background:#355b47; border-color:#355b47; }
	.reading { background:#f8f3e5 url('/public/ivory-paper.webp') center/620px; border:1px solid #b9bba8; border-left:9px solid #355b47; padding:clamp(17px,2.4vw,32px); box-shadow:0 4px 9px #14281f13; }
	header { display:flex; justify-content:space-between; gap:8px; padding-bottom:12px; border-bottom:1px solid #c7c9b8; color:#5c6758; font:.75rem/1.4 var(--pub-record); }
	.reading-main { min-height:205px; padding:20px 0; }
	.reading h3 { font:500 1.04rem/1.43 var(--pub-record); letter-spacing:0; }
	.source-person { margin-top:4px!important; color:#596253; font:.76rem/1.45 var(--pub-record); }
	blockquote { margin-top:23px!important; color:#253729; font:1.06rem/1.5 var(--pub-record); }
	blockquote.testimony { font-family:var(--pub-body); }
	mark { background:#ecd69e; color:inherit; }
	.reading > a { display:inline-flex; align-items:center; gap:8px; color:#35583f; min-height:44px; font:600 .83rem/1.4 var(--pub-body); }
	@media(max-width:500px){ .desk-tabs button{font-size:max(12px,.8rem);} .reading{border-left-width:6px;} }
</style>
