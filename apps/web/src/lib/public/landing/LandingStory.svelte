<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { ArrowRight, ArrowUpRight, Check, RotateCcw } from '@lucide/svelte';
	import type { Lang } from '@jude/core/domain';
	import Icon from '../Icon.svelte';
	import SourceDesk from '../SourceDesk.svelte';
	import { around, sources, type LandingRecord } from './landing-record';
	import { followStory } from './landing-motion';
	import { order, place, across, pins, threads, wires, rings } from './landing-desk';
	import { translate, type Key } from './landing-text';
	import './landing-story.css';

	let { lang,record }: {lang:Lang;record:LandingRecord}=$props();
	let t = $derived((key:Key, vars?: Record<string,number|string>) => translate(lang,key,vars));
	let root:HTMLElement, sheet:HTMLElement;
	let playing=$state(false), offscreen=$state(false), hidden=$state(false);
	let scrolly=$state(false), pinned=$state(false);
	let raised=$derived(around(record.testimony,sources[0].mark));
	let bapQuote=$derived(around(record.written,sources[1].mark));
	let logCited=$derived(around(record.gate,sources[2].mark));
	let introCited=$derived(around(record.intro,'pukul 10.00 WIB'));
	let quietLines=$derived([
		{who:'lp.whoPu' as const, speaker:'pu', text:record.firstQuestion},
		{who:'role.witness' as const, speaker:'rina', text:record.firstAnswer},
		{who:'lp.whoPu' as const, speaker:'pu', text:record.timeQuestion}
	]);
	let samplePage=$derived({
		heading:['BERITA ACARA PEMERIKSAAN SAKSI','BAP SAKSI RINA HARTATI'],
		labels:{q:'Pertanyaan',a:'Jawaban'},folio:'4 / 6',
		items:[
			{n:3,q:'Kapan Saudara tiba di Gudang B pada hari Sabtu, 14 Maret 2026?',a:record.written,mark:sources[1].mark},
			{n:4,q:'Apa yang Saudara lihat menjelang tengah malam?',a:record.vehicle,mark:''}
		]
	});
	let slips=$derived([
		{id:'bap',meta:'lp.g.bapMeta' as const,text:record.written,mark:sources[1].mark,rel:'conflicts' as const,href:sources[1].href},
		{id:'log',meta:'lp.g.logMeta' as const,text:record.gate,mark:sources[2].mark,rel:'conflicts' as const,href:sources[2].href},
		{id:'shift',meta:'lp.g.shiftMeta' as const,text:record.shift,mark:'',rel:'context' as const,href:'/demo/hearings/h2?s=s214'},
		{id:'law',meta:'lp.g.lawMeta' as const,text:record.charge,mark:'',rel:'related' as const,href:'/demo/documents/d4?p=d4p4'}
	]);
	async function replay() {
		if (!scrolly) return;
		playing=false;
		await tick();
		void sheet.offsetWidth;
		playing=true;
	}
	onMount(()=>{
		const stop = followStory(root,(moving,desktop)=>{scrolly=moving;pinned=desktop;});
		const observer=new IntersectionObserver(([entry])=>{
			offscreen=!entry.isIntersecting;
			if (entry.isIntersecting && scrolly) playing=true;
		});
		observer.observe(sheet);
		function visibility(){ hidden=document.hidden; }
		document.addEventListener('visibilitychange',visibility);
		const anchor=page.url.hash.slice(1) || page.url.searchParams.get('to');
		let frame=0;
		if (anchor && ['lp-source','lp-how','lp-approach','lp-close'].includes(anchor)) {
			frame=requestAnimationFrame(()=>{
				const target=document.getElementById(anchor);
				if (document.activeElement !== document.body && document.activeElement !== target) return;
				target?.scrollIntoView({block:'start'});
				target?.focus({preventScroll:true});
			});
		}
		return ()=>{cancelAnimationFrame(frame);stop();observer.disconnect();document.removeEventListener('visibilitychange',visibility);};
	});
</script>

{#snippet ringField(where: string, drift = false)}
  <svg class="rings rings-{where}" viewBox="-720 -720 1440 1440" aria-hidden="true" focusable="false" data-drift={drift || undefined}>
    {#each rings as ring (ring.r)}<circle r={ring.r} stroke-opacity={ring.o} />{/each}
  </svg>
{/snippet}


{#snippet initials(id:string,size:number)}
	<span aria-hidden="true" class="source-disc" data-role={id} style:--disc-size={size+'px'}>{id==='rina'?'R':id.toUpperCase()}</span>
{/snippet}
<div class="lp" bind:this={root} class:scrolly class:pinned>
  <header class="cover" data-scene="hero">
    <div class="frame">
      {@render ringField("hero")}
      <div class="opening">
        <h1 class="display">
          <span>{t("lp.title1")}</span>
          <span class="turn">{t("lp.title2")}</span>
        </h1>
        <p class="lead">{t("lp.lead")}</p>
        <div class="actions">
          <a class="button cream" href="/demo">{t("lp.demo")}<ArrowRight size={22} strokeWidth={1.5} /></a>
          <a class="button outline" href="#lp-how">{t("lp.how")}</a>
        </div>
      </div>
      <img class="clay clay-gavel gavel" src="/public/clay/gavel.webp" alt="" aria-hidden="true" decoding="async" fetchpriority="low" />

      <figure class="sheet paper" class:run={playing} class:held={offscreen || hidden} bind:this={sheet}>
        <figcaption class="sheet-bar">
          <span class="sample">{t("lp.sample")}</span>
          {#if scrolly}<button class="replay" onclick={replay}><RotateCcw size={14} />{t("lp.replay")}</button>{/if}
        </figcaption>
        <div class="compare">
          <div class="side">
            <h2 class="side-label">{t("lp.testimony")}</h2>
            <blockquote class="quote" lang="id">“…jam <span class="hl one">{raised[1]}</span>{raised[2]}”</blockquote>
            <a class="source" href={sources[0].href}>
              <Icon name="mic" size={15} />{t("lp.transcript")} · <span class="tabular">00:14:32</span>
            </a>
          </div>
          <div class="finding">
            <a href="/demo/findings/f1" class="pill cover-finding">{t("status.potential_inconsistency")}</a>
            <span class="thread" aria-hidden="true"><i class="end"></i><i class="line"></i><i class="end"></i></span>
            <p class="check">{t("lp.check")}</p>
          </div>
          <div class="side earlier">
            <h2 class="side-label">{t("lp.earlier")}</h2>
            <p class="quote typed" lang="id">“…<span class="hl two">{bapQuote[1]}</span>…”</p>
            <a class="source" href={sources[1].href}>
              <Icon name="file" size={15} />{t("lp.witnessStatement")} · {t("common.page", { n: 4 })}
            </a>
          </div>
        </div>
      </figure>
    </div>
  </header>

  <div class="chapters">
    <section class="intro wrap" id="lp-source" tabindex="-1" aria-labelledby="lp-source-title">
      <div>
        <h2 class="rufina" id="lp-source-title">{t("lp.sourceTitle")}</h2>
        <p class="intro-lead">{t("lp.sourceLead")}</p>
      </div>
      <p class="intro-aside">{t("lp.sourceAside")}</p>
      <img class="clay clay-folder" src="/public/clay/folder.webp" alt="" aria-hidden="true" loading="lazy" decoding="async" data-drift />
      <img class="clay clay-quote" src="/public/clay/quote.webp" alt="" aria-hidden="true" loading="lazy" decoding="async" data-drift />
    </section>

    <section class="gather wrap" aria-label={t("lp.g.label")}>
      <div class="scene gather-scene" data-scene="gather">
        <div class="stage">
          <div class="desk">
            <svg class="wires" viewBox="0 0 1200 560" aria-hidden="true">
              {#each slips as s (s.id)}
                <path class="wire" class:suggested={s.rel !== "conflicts"} data-rel={s.rel} data-slip={s.id} d={wires[s.id].d} pathLength="1" />
              {/each}
            </svg>
            <!-- The case file: a few sheets under the testimony, which the sources are drawn out of. -->
            <span class="file" aria-hidden="true"></span>
            <article class="slip statement" data-rise>
              <a class="slip-meta linked-source" href={sources[0].href}>{@render initials("rina",18)}{t("lp.g.statementMeta")}</a>
              <p class="statement-text" lang="id">“{record.testimony}”</p>
            </article>
            {#each slips as s (s.id)}
              {@const parts = around(s.text, s.mark)}
              <article class="slip source-slip {s.id}" data-rise>
                <a class="slip-meta linked-source" href={s.href}>{#if s.id === "shift"}{@render initials("rina",18)}{:else}<Icon name={s.id === "law" ? "book" : "file"} size={13} />{/if}{t(s.meta)}</a>
                <p class="slip-text" lang="id" class:typed={s.id !== "shift"}>{parts[0]}{#if parts[1]}<mark>{parts[1]}</mark>{/if}{parts[2]}</p>
                <p class="slip-rel" data-rel={s.rel}>{t(`rel.${s.rel}`)}</p>
              </article>
              <span class="wire-label" data-rel={s.rel} data-slip={s.id} style:left="{wires[s.id].x}%" style:top="{wires[s.id].y}%">{t(`rel.${s.rel}`)}</span>
            {/each}
          </div>
          <p class="legend">{t("lp.g.legend")} · {t("lp.sample")}</p>
        </div>
      </div>
    </section>

    <section class="showcase" aria-labelledby="lp-show-title">
      <div class="scene show-scene" data-scene="show">
        <div class="stage show-stage">
          {@render ringField("show", true)}
          <img class="clay clay-spool" src="/public/clay/spool.webp" alt="" aria-hidden="true" loading="lazy" decoding="async" data-drift />
          <div class="show-copy">
            <header class="show-head">
              <h2 class="headline" id="lp-show-title">{t("lp.show.title1")}<br />{t("lp.show.title2")}</h2>
              <p class="show-lead">{t("lp.show.lead")}</p>
            </header>
            <p class="show-status" aria-hidden="true">
              <span class="st-cue">{t("lp.show.cue")}</span>
              <span class="st-read">{t("lp.show.reading", { n: order.length })}</span>
              <span class="st-linked">{t("lp.show.linked", { n: pins.length })}</span>
            </p>
            <SourceDesk {lang} {record}/>
            <p class="show-sample">{t("lp.sample")}</p>
          </div>
          <p class="sr-only">{t("lp.show.alt")}</p>
          <div class="tb-wrap" lang="id" aria-hidden="true">
            <div class="tb">
              <div class="tb-paper p-bap key" style={place("bap")}>
                <p class="pp-folio">{samplePage.folio}</p>
                {#each samplePage.heading as line (line)}<p class="pp-heading">{line}</p>{/each}
                <p class="pp-typed pp-intro">{introCited[0]}<mark class="tb-c" style:--mx={across("bap", 0.5, 0.33)}>{introCited[1]}</mark>{introCited[2]}</p>
                <p class="pp-typed pp-key"><u>{samplePage.labels.a}:</u> {bapQuote[0]}<mark class="tb-c key" style:--mx={across("bap", 0.45, 0.72)}>{bapQuote[1]}</mark>{bapQuote[2]}</p>
              </div>
              <div class="tb-paper p-law" style={place("law")}>
                <p class="pp-head">{t("lp.v2.d4")}</p>
                <p class="pp-typed">{record.charge}</p>
                <span class="pp-lines"><i></i><i></i><i></i><i></i></span>
              </div>
              <div class="tb-paper p-talk key" style={place("talk")}>
                <p class="pp-head">TRANSKRIP SIDANG 2</p>
                <span class="pp-wave">{#each [3, 6, 4, 9, 5, 8, 3, 7, 10, 6, 4, 8, 5, 9, 3, 6, 8, 4, 7, 5] as h, i (i)}<i style:--h={h}></i>{/each}</span>
                {#each quietLines as line (line.text)}<p class="pp-line"><b>{t(line.who)}</b> {line.text}</p>{/each}
                <p class="pp-line pp-key"><b>{t("role.witness")}</b> {raised[0]}<mark class="tb-c key" style:--mx={across("talk", 0.45, 0.7)}>{raised[1]}</mark>{raised[2]}</p>
              </div>
              <div class="tb-paper p-roster" style={place("roster")}>
                <p class="pp-head">JADWAL JAGA GUDANG B</p>
                <p class="pp-typed">{record.schedule}</p>
              </div>
              <div class="tb-paper p-log key" style={place("log")}>
                <p class="pp-folio">7 / 12</p>
                <p class="pp-head">LAPORAN LOG AKSES GERBANG</p>
                <p class="pp-typed pp-key">{logCited[0]}<mark class="tb-c key" style:--mx={across("log",0.24,0.633)}>{logCited[1]}</mark>{logCited[2]}</p>
              </div>
              <div class="tb-paper p-cctv" style={place("cctv")}>
                <span class="cc-frame"><span class="cc-cam">GERBANG TIMUR · GUDANG B</span><mark class="tb-c cc-stamp" style:--mx={across("cctv", 0.68, 0.22)}>14-03-2026 · 23:48:12</mark></span>
              </div>
              <div class="tb-light"></div>
              <svg class="tb-threads" viewBox="0 0 1000 640" preserveAspectRatio="none">
                {#each threads as d, i (i)}<path {d} pathLength="1" style:--k={i} />{/each}
              </svg>
              {#each pins as pin (pin.n)}<span class="tb-pin" style:left="{pin.x / 10}%" style:top="{pin.y / 6.4}%">{pin.n}</span>{/each}
            </div>
          </div>
          <div class="show-finding">
            <span class="pill small">{t("status.potential_inconsistency")}</span>
            <p class="sf-title">{t("lp.v3.title")}</p>
            <p class="sf-ask"><span>{t("lp.v3.ask")}</span>{t("lp.v3.question")}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="how wrap" id="lp-how" tabindex="-1" aria-labelledby="lp-how-title">
      <div class="scene steps-scene" data-scene="how">
        <div class="stage">
      <header class="section-head">
        <h2 class="headline" id="lp-how-title">{t("lp.howTitle1")}<br />{t("lp.howTitle2")}</h2>
        <p>{t("lp.howLead")}</p>
        <img class="clay clay-book" src="/public/clay/bookmark.webp" alt="" aria-hidden="true" loading="lazy" decoding="async" data-drift />
      </header>
      <div class="steps-stage">
      <div class="plate-bg" aria-hidden="true"></div>
      <ol class="steps">
        <li class="step">
          <div class="caption">
            <h3>{t("lp.s1.title")}</h3>
            <p>{t("lp.s1.text")}</p>
          </div>
          <div class="plate" data-rise>
            <div class="vignette listen paper">
              <div class="v-line quiet">
                {@render initials("pu",36)}
                <div><span class="v-name">{t("lp.whoPu")}</span><p lang="id">{record.timeQuestion}</p></div>
              </div>
              <div class="v-line now">
                {@render initials("rina",46)}
                <div>
                  <span class="v-name">{t("role.witness")} Rina Hartati</span>
                  <p class="v-said" lang="id">{record.testimony}</p>
                </div>
              </div>
              <span class="v-sample">{t("lp.sample")}</span>
            </div>
          </div>
        </li>
        <li class="step flip">
          <div class="caption">
            <h3>{t("lp.s2.title")}</h3>
            <p>{t("lp.s2.text")}</p>
          </div>
          <div class="plate" data-rise>
            <div class="vignette reading paper">
              <p class="v-head">{t("lp.v2.title")}</p>
              <ul>
                <li><Icon name="file" size={15} /><span>{t("lp.v2.d1")}</span><span class="v-pages">{t("lp.v2.pages", { n: 6 })}</span><span class="v-state"><Check size={13} />{t("lp.v2.read")}</span></li>
                <li><Icon name="file" size={15} /><span>{t("lp.v2.d2")}</span><span class="v-pages">{t("lp.v2.pages", { n: 12 })}</span><span class="v-state"><Check size={13} />{t("lp.v2.read")}</span></li>
                <li><Icon name="file" size={15} /><span>{t("lp.v2.d3")}</span><span class="v-pages">{t("lp.v2.pages", { n: 9 })}</span><span class="v-state"><Check size={13} />{t("lp.v2.read")}</span></li>
                <li><Icon name="book" size={15} /><span>{t("lp.v2.d4")}</span><span class="v-pages">Pasal.id</span><span class="v-state"><Check size={13} />{t("lp.v2.referenced")}</span></li>
              </ul>
              <span class="v-sample">{t("lp.sample")}</span>
            </div>
          </div>
        </li>
        <li class="step">
          <div class="caption">
            <h3>{t("lp.s3.title")}</h3>
            <p>{t("lp.s3.text")}</p>
          </div>
          <div class="plate" data-rise>
            <div class="vignette examine paper">
              <span class="pill">{t("status.potential_inconsistency")}</span>
              <p class="v-title">{t("lp.v3.title")}</p>
              <p class="v-sub">{t("lp.v3.checked")}</p>
              <ul class="v-checks">
                <li>{t("lp.v3.alt")}</li>
                <li>{t("lp.v3.context")}</li>
              </ul>
              <p class="v-sub">{t("lp.v3.ask")}</p>
              <p class="v-question">{t("lp.v3.question")}</p>
              <span class="v-sample">{t("lp.sample")}</span>
            </div>
          </div>
        </li>
      </ol>
      <div class="step-rule" aria-hidden="true"><span></span></div>
      </div>
        </div>
      </div>
    </section>

    <section class="signal wrap" aria-labelledby="lp-signal-title">
      <div class="scene signal-scene" data-scene="signal">
        <div class="stage">
      <header class="section-head">
        <h2 class="headline" id="lp-signal-title">{t("lp.signalTitle")}</h2>
        <p>{t("lp.signalLead")}</p>
      </header>
      <figure class="transcript paper">
      <img class="clay clay-finding" src="/public/clay/finding.webp" alt="" aria-hidden="true" loading="lazy" decoding="async" />
      <ol class="t-list">
        {#each quietLines as line (line.text)}
          <li class="t-row" data-rise>
            <span class="t-who">{@render initials(line.speaker,20)}{t(line.who)}</span>
            <p class="t-text" lang="id">{line.text}</p>
            <span></span>
          </li>
        {/each}
        <li class="t-row raised" data-rise>
          <span class="t-who">{@render initials("rina",20)}{t("role.witness")}</span>
          <p class="t-text" lang="id">{raised[0]}<mark>{raised[1]}</mark>{raised[2]}</p>
          <span class="pill small">{t("status.potential_inconsistency")}</span>
          <a class="t-note linked-source" href={sources[0].href}>{t("lp.transcript")} · 00:14:32 <ArrowUpRight size={14}/></a>
        </li>
        <li class="t-row" data-rise>
          <span class="t-who">{@render initials("rina",20)}{t("role.witness")}</span>
          <p class="t-text" lang="id">{record.laterAnswer}</p>
          <span></span>
        </li>
      </ol>
      <figcaption class="panel-sample">{t("lp.sample")}</figcaption>
      </figure>
        </div>
      </div>
    </section>

    <section class="page-spread wrap" aria-labelledby="lp-page-title">
      <header class="section-head">
        <h2 class="headline" id="lp-page-title">{t("lp.pageTitle")}</h2>
        <div class="spread-text">
          <p>{t("lp.pageText")}</p>
          <p class="quiet">{t("lp.pageOriginal")}</p>
        </div>
      </header>
      <div class="scene page-scene" data-scene="page">
        <div class="stage">
      <div class="page-row">
        <div class="page-sheet paper" lang="id">
          <img class="clay clay-clip" src="/public/clip.webp" alt="" aria-hidden="true" loading="lazy" decoding="async" />
          <p class="page-folio tabular">{samplePage.folio}</p>
          {#each samplePage.heading as line (line)}<p class="page-heading">{line}</p>{/each}
          <p class="page-intro">Rina Hartati · Gudang B · PT Sinar Logistik Contoh</p>
          <ol class="page-items">
            {#each samplePage.items as item (item.n)}
              {@const parts = around(item.a, item.mark)}
              <li>
                <span class="page-n tabular">{item.n}.</span>
                <div class="page-qa">
                  <p><span class="page-tag">{samplePage.labels.q}:</span> {item.q}</p>
                  <p><span class="page-tag">{samplePage.labels.a}:</span> {parts[0]}{#if parts[1]}<mark data-rise>{parts[1]}</mark>{/if}{parts[2]}</p>
                  {#if item.mark}
                    <aside class="margin-note in-margin" lang={lang}>
                      <span class="pill small">{t("status.potential_inconsistency")}</span>
                      <p>{t("lp.pageNote")} <q lang="id">{record.testimony}</q></p>
                    </aside>
                  {/if}
                </div>
              </li>
            {/each}
          </ol>
          <a class="page-sample linked-source" lang={lang} href={sources[1].href}>{t("lp.witnessStatement")} · {t("common.page", {n:4})} <ArrowUpRight size={15}/></a>
        </div>
        <aside class="margin-note below-page" data-rise>
          <span class="pill small">{t("status.potential_inconsistency")}</span>
          <p>{t("lp.pageNote")} <q lang="id">{record.testimony}</q></p>
        </aside>
        <img class="clay clay-magnifier" src="/public/clay/magnifier.webp" alt="" aria-hidden="true" loading="lazy" decoding="async" />
      </div>
        </div>
      </div>
    </section>

    <section class="approach wrap" id="lp-approach" tabindex="-1" aria-labelledby="lp-approach-title">
      <header class="section-head">
        <h2 class="headline" id="lp-approach-title">{t("lp.approachTitle1")}<br />{t("lp.approachTitle2")}</h2>
        <p>{t("lp.approachLead")}</p>
        <img class="clay clay-scales" src="/public/clay/scales.webp" alt="" aria-hidden="true" loading="lazy" decoding="async" data-drift />
      </header>
      <ul class="principles">
        <li><h3>{t("lp.p1.title")}</h3><p>{t("lp.p1.text")}</p></li>
        <li><h3>{t("lp.p2.title")}</h3><p>{t("lp.p2.text")}</p></li>
        <li><h3>{t("lp.p3.title")}</h3><p>{t("lp.p3.text")}</p></li>
      </ul>
    </section>

    <section class="closing" id="lp-close" tabindex="-1" data-scene="closing" aria-labelledby="lp-closing-title">
      <div class="closing-frame">
        {@render ringField("closing", true)}
        <div class="closing-copy">
          <h2 class="headline" id="lp-closing-title">{t("lp.closingTitle1")}<br />{t("lp.closingTitle2")}</h2>
          <p>{t("lp.closingLead")}</p>
          <div class="actions">
            <a class="button cream" href="/demo">{t("lp.demo")}<ArrowRight size={22} strokeWidth={1.5} /></a>
            <a class="button outline" href="/cases">{t("lp.open")}</a>
          </div>
        </div>
        <div class="clay-set" aria-hidden="true">
          <img class="clay clay-speech" src="/public/clay/speech.webp" alt="" loading="lazy" decoding="async" data-drift />
          <img class="clay clay-page" src="/public/clay/page.webp" alt="" loading="lazy" decoding="async" data-drift />
          <img class="clay clay-connect" src="/public/clay/connect.webp" alt="" loading="lazy" decoding="async" data-drift />
        </div>
        <div class="closing-slip paper">
          <span class="pill">{t("status.potential_inconsistency")}</span>
          <p class="v-title">{t("lp.v3.title")}</p>
          <a class="closing-done linked-source" href="/demo/findings/f1">{t("lp.inspect")} <ArrowUpRight size={15}/></a>
          <span class="v-sample">{t("lp.sample")}</span>
        </div>
      </div>
    </section>
  </div>
</div>
