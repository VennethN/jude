<script lang="ts">
	import type { Language } from '@jude/core/plans';
	import Icon from './Icon.svelte';
	let { lang }: { lang: Language } = $props();
	let isId = $derived(lang === 'id');
</script>
<figure class="case-cover" aria-label={isId ? 'Perbandingan sumber dalam perkara sintetis' : 'Source comparison in the synthetic case'}>
	<div class="case-spread">
		<div class="back-file" aria-hidden="true"><div class="file-tab">112 / PID.B</div></div>
		<div class="back-leaf" aria-hidden="true"></div>
		<div class="case-leaf">
			<img class="paperclip" src="/public/clip.webp" width="63" height="84" alt=""/>
			<div class="folio"><span class="sample">{isId ? 'Contoh sintetis' : 'Synthetic example'}</span><span>{isId ? 'Sidang 02' : 'Hearing 02'}</span></div>
			<div class="file-head"><div class="file-disc">RH</div><div><b>Rina Hartati</b><small>{isId ? 'Pemeriksaan saksi' : 'Witness examination'}</small></div></div>
			<div class="source-label"><Icon name="mic" size={15}/>{isId ? 'Transkrip sidang' : 'Hearing transcript'}<time>00:14:32</time></div>
			<blockquote lang="id">“Saya sampai di gudang jam <mark>setengah sepuluh malam</mark>, Pak.”</blockquote>
			<div class="record">
				<div class="source-label"><Icon name="file" size={15}/>{isId ? 'BAP saksi' : 'Written statement'}<span>{isId ? 'hal. 4' : 'p. 4'}</span></div>
				<p lang="id">“…saya tiba di gudang <mark>sedikit setelah pukul 20.00 WIB</mark> untuk menggantikan rekan saya…”</p>
			</div>
			<div class="file-foot"><span><i></i>{isId ? 'Periksa waktu kedatangan' : 'Check the time of arrival'}</span><a href="/demo/findings/f1" aria-label={isId ? 'Buka temuan waktu kedatangan' : 'Open the arrival-time finding'}><Icon name="forward" size={16}/></a></div>
		</div>
	</div>
</figure>
<style>
	.case-cover { position: relative; width: min(100%, 510px); justify-self: center; color: #24362d; }
	.case-spread { position: relative; padding: 7% 6% 10% 4%; isolation: isolate; }
	.back-file, .back-leaf, .case-leaf { border-radius: 2px 4px 3px 2px; }
	.back-file { position: absolute; z-index: -2; inset: 9% 3% 5% 5%; background: #bc9d70 url('/public/ivory-paper.webp') center/630px; background-blend-mode: multiply; transform: rotate(7deg); box-shadow: 0 18px 38px #07191070; }
	.file-tab { position:absolute; top:-30px; left:3%; min-width:112px; height:32px; padding:6px 12px 0; border-radius:6px 6px 0 0; background:#b79867; color:#292a20; text-align:center; white-space:nowrap; font: max(12px,.8rem)/1.3 var(--pub-record); }
	.back-leaf { position: absolute; inset: 9% 1% 8% 8%; z-index:-1; background:#dbceb0 url('/public/ivory-paper.webp') center/570px; background-blend-mode: multiply; transform:rotate(2.5deg); }
	.case-leaf { position:relative; background:#f8f3e5 url('/public/ivory-paper.webp') 45% 40%/620px; padding:6% 7% 2%; transform:rotate(-3deg); box-shadow:0 8px 19px #14281f39; }
	.paperclip { position:absolute; width:32px; height:auto; top:-17px; right:38%; transform:rotate(-23deg); }
	.folio,.source-label,.file-foot,.file-head { display:flex; align-items:center; }
	.folio { justify-content:space-between; gap:15px; padding-bottom:12px; border-bottom:1px solid #bebdac; color:#546052; font: max(12px,.8rem)/1.4 var(--pub-record); }
	.file-head { gap:12px; margin:20px 0 22px; }
	.file-disc { flex:none; border-radius:50%; width:43px; height:43px; display:grid; place-items:center; background:#dbe0d0; color:#314833; font:500 .8rem/1 var(--pub-body); }
	.file-head b { display:block; font:400 clamp(1.6rem,2.65vw,2.35rem)/1.05 var(--pub-display); }
	.file-head small { display:block; color:#596357; font-size:max(12px,.8rem); margin-top:4px; }
	.source-label { gap:6px; font:600 max(12px,.8rem)/1.4 var(--pub-body); color:#4c5b4d; }
	.source-label time,.source-label span { margin-left:auto; color:#536254; font: max(12px,.8rem)/1.4 var(--pub-record); }
	blockquote { margin:7px 0 15px!important; font:500 clamp(.99rem,1.5vw,1.23rem)/1.53 var(--pub-body); }
	mark { color:inherit; background:#f1d69b; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
	.record { padding:13px 0 0; border-top:1px solid #bdbca9; }
	.record p { font: .91rem/1.52 var(--pub-record); margin-top:7px!important; }
	.record mark { background:#e2d3ae; }
	.file-foot { justify-content:space-between; margin-top:8px; color:#664237; font:500 max(12px,.8rem)/1.4 var(--pub-body); }
	.file-foot > span { display:flex; align-items:center; gap:6px; }
	.file-foot i { width:7px; height:7px; background:#be8445; transform:rotate(45deg); }
	.file-foot a { color:inherit; display:grid; place-items:center; width:44px; height:44px; }
	.sample { color:#4a5949; font:600 max(12px,.8rem)/1.4 var(--pub-body); }
	@media(max-width:560px){ .case-cover{width:min(100%,410px);} .file-head{margin:14px 0;} .file-disc{width:34px;height:34px;} .record{padding-top:10px;} .file-foot{margin-top:2px;} .case-spread{padding:7% 6% 8% 4%;} }
</style>
