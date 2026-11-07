<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageProps } from './$types';
  import { Plus } from '@lucide/svelte';
  import { currency } from '@jude/core/plans';
  import Icon from '$lib/public/Icon.svelte';
  import CyclePicker from '$lib/public/CyclePicker.svelte';
  import PlanList from '$lib/public/PlanList.svelte';
  import PlanAction from '$lib/public/PlanAction.svelte';
  import PlanComparison from '$lib/public/PlanComparison.svelte';
  import SalesContact from '$lib/public/SalesContact.svelte';
  import { essentials, faq } from '$lib/public/pricing';
  import { rings } from '$lib/public/landing/landing-desk';

  let { data, form }: PageProps = $props();
  const id = $derived(data.lang === 'id');
  const signedIn = $derived(Boolean(data.session && !data.session.user.guest));
  const current = $derived(signedIn ? data.session?.plan.id : undefined);
  const pro = $derived(data.plans.find((plan) => plan.id === 'pro'));
  const hourly = $derived(
    pro?.quotas.hours
      ? Math.round(
          ((data.cycle === 'yearly' ? pro.yearlyPerMonth : pro.monthly) ?? 0) / pro.quotas.hours / 100,
        ) * 100
      : null,
  );
  let sales: SalesContact;
  const contact = () => sales?.open();
  function openContact(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    contact();
  }
  let navigationShown = $state(false);
  let scope: HTMLElement;
  onMount(() => {
    const plans = scope.querySelector('#plans');
    const table = scope.querySelector('.table-wrap');
    const closing = scope.querySelector('.closing');
    if (!plans || !table || !closing || !('IntersectionObserver' in window)) return;
    let pastPlans = false,
      atTable = false,
      atClose = false;
    const update = () => (navigationShown = pastPlans && !atTable && !atClose);
    const sections = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === plans) pastPlans = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
        if (entry.target === closing) atClose = entry.isIntersecting || entry.boundingClientRect.bottom < 0;
      }
      update();
    });
    const stickyTable = new IntersectionObserver(
      ([entry]) => {
        atTable = entry.isIntersecting;
        update();
      },
      { rootMargin: '0px 0px -88% 0px' },
    );
    sections.observe(plans);
    sections.observe(closing);
    stickyTable.observe(table);
    return () => {
      sections.disconnect();
      stickyTable.disconnect();
    };
  });
</script>

<svelte:head>
  <title>{id ? 'Paket dan harga' : 'Plans and pricing'} · Jude</title>
  <meta
    name="description"
    content={id
      ? 'Bandingkan paket ruang kerja Jude untuk sidang, dokumen, dan asisten perkara.'
      : 'Compare Jude workspace plans for hearings, documents and your case assistant.'}
  />
</svelte:head>

{#snippet ringField(position: 'cover' | 'closing')}
  <svg class={'rings rings-' + position} viewBox="-720 -720 1440 1440" aria-hidden="true" focusable="false">
    {#each rings as ring (ring.r)}<circle r={ring.r} stroke-opacity={ring.o} />{/each}
  </svg>
{/snippet}
<div class="pricing" bind:this={scope}>
  {#if pro}<nav
      class="quick-nav"
      class:shown={navigationShown}
      inert={!navigationShown}
      aria-label={id ? 'Navigasi harga' : 'Pricing navigation'}
    >
      <a class="word" href="/">jude.</a>
      <div>
        <a href="#plans">{id ? 'Paket' : 'Plans'}</a><a href="#pr-compare"
          >{id ? 'Perbandingan' : 'Comparison'}</a
        ><a href="#pr-faq">FAQ</a>
      </div>
      <PlanAction
        plan={pro}
        cycle={data.cycle}
        lang={data.lang}
        {signedIn}
        {current}
        {contact}
        placement="bar"
      />
    </nav>{/if}
  <header class="pricing-cover cloth">
    {@render ringField('cover')}
    <section class="pricing-intro">
      <div class="hero-copy">
        <h1>
          <span>{id ? 'Harga yang jelas,' : 'Clear pricing,'}</span><span
            >{id ? 'untuk setiap jam sidang.' : 'for every hearing hour.'}</span
          >
        </h1>
        <p>
          {id
            ? 'Mulai gratis dengan Dasar, atau coba Advokat Pro 14 hari tanpa kartu. Di paket apa pun, setiap temuan datang dengan sumbernya.'
            : 'Start free with Basic, or try Advocate Pro for 14 days without a card. On every plan, each finding comes with its sources.'}
        </p>
      </div>
      <div class="terms">
        <CyclePicker cycle={data.cycle} lang={data.lang} cover />
        <ul>
          <li>
            <Icon name="check" size={16} />{id
              ? '14 hari gratis, tanpa kartu kredit'
              : '14 days free, no credit card'}
          </li>
          <li>
            <Icon name="check" size={16} />{id
              ? 'Ganti atau berhenti kapan saja'
              : 'Change or cancel anytime'}
          </li>
          <li>
            <Icon name="check" size={16} />{id ? 'Paket Dasar gratis selamanya' : 'Basic is always free'}
          </li>
        </ul>
        {#if pro && hourly !== null}<p>
            {pro.name[data.lang]}
            {data.cycle === 'yearly'
              ? id
                ? 'ditagih tahunan'
                : 'billed yearly'
              : id
                ? 'ditagih bulanan'
                : 'billed monthly'}<br />{id ? 'sekitar' : 'about'}
            {currency(hourly, data.lang)}
            {id ? 'per jam sidang.' : 'per hearing hour.'}
          </p>{/if}
      </div>
      <img class="scales" src="/public/clay/scales.webp" alt="" width="144" height="144" decoding="async" />
    </section>
    <section class="plans" id="plans" aria-label={id ? 'Paket ruang kerja' : 'Workspace plans'}>
      <PlanList
        plans={data.plans}
        lang={data.lang}
        cycle={data.cycle}
        selected={data.target}
        {signedIn}
        {current}
        {contact}
      />
    </section>
    <p class="plans-foot">
      <a href="#pr-compare"
        >{id ? 'Bandingkan semua paket' : 'Compare every plan'} <Icon name="arrow" size={17} /></a
      >
      <span
        >{id
          ? 'Harga dan kuota yang tertera adalah contoh dalam rupiah. Tagihan disimulasikan tanpa menagih kartu Anda.'
          : 'These example prices are in Indonesian rupiah. Billing is simulated and your card is never charged.'}</span
      >
    </p>
  </header>

  <section class="always wrap" aria-labelledby="essentials-title">
    <div>
      <h2 id="essentials-title">
        {id ? 'Di paket apa pun, sumbernya selalu terlihat.' : 'On every plan, the source is always in view.'}
      </h2>
    </div>
    <ul>
      {#each essentials as feature}<li>
          <img
            src={'/public/clay/' + feature.clay + '.webp'}
            alt=""
            width="64"
            height="64"
            loading="lazy"
            decoding="async"
          />
          <h3>{feature.title[data.lang]}</h3>
          <p>{feature.text[data.lang]}</p>
        </li>{/each}
    </ul>
  </section>
  <section class="compare wrap" id="pr-compare" aria-labelledby="compare-title">
    <header class="section-head">
      <h2 id="compare-title">{id ? 'Bandingkan semua paket' : 'Compare every plan'}</h2>
      <p>
        {id
          ? 'Kuota dan fitur setiap paket, berdampingan.'
          : 'Each plan’s quotas and features, side by side.'}
      </p>
    </header>
    <PlanComparison plans={data.plans} lang={data.lang} cycle={data.cycle} {signedIn} {current} {contact} />
  </section>
  <section class="faq wrap" id="pr-faq" aria-labelledby="faq-title">
    <div class="faq-head">
      <h2 id="faq-title">{id ? 'Pertanyaan yang sering diajukan' : 'Questions, answered'}</h2>
      <p>
        {id ? 'Masih ada pertanyaan?' : 'Still have a question?'}
        <a href={'?cycle=' + data.cycle + '&contact=1#partner'} onclick={openContact}
          >{id ? 'Bicara dengan kami' : 'Talk to us'}</a
        >
      </p>
      <img
        class="bookmark"
        src="/public/clay/bookmark.webp"
        alt=""
        width="92"
        height="100"
        loading="lazy"
        decoding="async"
      />
    </div>
    <div>
      {#each faq as item}<details name="pricing-questions">
          <summary>{item.q[data.lang]}<Plus size={20} strokeWidth={1.5} aria-hidden="true" /></summary>
          <p>{item.a[data.lang]}</p>
        </details>{/each}
    </div>
  </section>
  <section class="closing cloth" aria-labelledby="close-title">
    {@render ringField('closing')}
    <div>
      <h2 id="close-title">
        {id ? 'Sidang berikutnya,' : 'Your next hearing,'}<br />{id ? 'Anda sudah siap.' : 'ready for it.'}
      </h2>
      <p>
        {id
          ? 'Coba Advokat Pro 14 hari tanpa kartu, atau lihat dulu perkara contoh.'
          : 'Try Advocate Pro for 14 days without a card, or explore the example case first.'}
      </p>
      <div class="close-actions">
        {#if pro}<PlanAction
            plan={pro}
            cycle={data.cycle}
            lang={data.lang}
            {current}
            {signedIn}
            {contact}
            placement="hero"
          />{/if}
        <a class="demo" href="/demo">{id ? 'Coba perkara contoh' : 'Explore the example case'}</a>
      </div>
    </div>
    <div class="clay-files" aria-hidden="true">
      <img src="/public/clay/folder.webp" alt="" width="230" height="230" loading="lazy" decoding="async" />
      <img src="/public/clay/finding.webp" alt="" width="120" height="120" loading="lazy" decoding="async" />
    </div>
  </section>
  <SalesContact
    bind:this={sales}
    lang={data.lang}
    initial={data.showContact}
    result={form}
    profile={signedIn ? data.session?.user : null}
  />
</div>

<style>
  .pricing {
    --space: 96px;
    --rule: #d8d5ca;
    --forest: #173a2c;
    --muted: #555f52;
    --paper: #f6f0e5;
    --surface: #fcfaf4;
    --line: #cbd0c1;
    background: #faf7f0;
    color: #1d3629;
    font: 400 15px/1.65 var(--pub-body);
  }
  .wrap {
    width: min(90%, 1440px);
    margin-inline: auto;
  }
  .pricing h2 {
    font: 400 clamp(38px, 3.6vw, 56px)/1.06 var(--pub-display);
    letter-spacing: -0.022em;
  }
  .cloth {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    margin-inline: 14px;
    border-radius: 28px;
    background: #16382b;
    background-image:
      linear-gradient(145deg, #65a07d44, transparent 50%, #071a1255), url('/public/case-cloth.webp');
    background-size:
      100% 100%,
      1300px auto;
    color: #f7efdf;
  }
  .rings {
    position: absolute;
    z-index: -1;
    top: 0;
    right: 0;
    width: clamp(900px, 92vw, 1440px);
    height: auto;
    aspect-ratio: 1;
    color: #f5ebd8;
    stroke: currentColor;
    fill: none;
    pointer-events: none;
  }
  .rings circle {
    vector-effect: non-scaling-stroke;
    stroke-width: 1;
  }
  .rings-cover {
    translate: calc(50% + 24px) calc(-50% - 70px);
  }
  .rings-closing {
    opacity: 0.8;
    translate: calc(50% - 200px) calc(-50% + 40px);
  }
  .pricing-cover {
    margin-top: 14px;
    padding: 0 5% 40px;
  }
  .pricing-intro {
    position: relative;
    display: grid;
    gap: 32px clamp(40px, 6vw, 110px);
    grid-template-columns: minmax(0, 7fr) minmax(300px, 4fr);
    align-items: end;
    padding-top: calc(103px + clamp(28px, 5vh, 60px));
    padding-bottom: clamp(44px, 6vh, 64px);
  }
  .hero-copy h1 {
    font:
      400 clamp(48px, calc(4.7vw / var(--z, 1)), 76px)/0.98 Rufina,
      Georgia,
      serif;
    color: #f4e9d3;
    letter-spacing: -0.025em;
    text-wrap: initial;
  }
  .hero-copy h1 span {
    display: block;
    text-wrap: balance;
  }
  .hero-copy p {
    max-width: 31em;
    margin-top: 26px;
    color: #e1e6d8;
    font-size: 19px;
    line-height: 1.6;
  }
  .terms {
    align-self: end;
    display: grid;
    justify-items: start;
    gap: 26px;
  }
  .terms ul {
    list-style: none;
    display: grid;
    gap: 9px;
    padding: 0;
    margin: 0;
  }
  .terms li {
    min-height: 28px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 15.5px;
  }
  .terms :global(.cycle-switch small) {
    font-size: 12px;
  }
  .terms :global(svg) {
    color: #e9c27e;
  }
  .terms p {
    width: 100%;
    border-top: 1px solid #fff4de40;
    padding-top: 18px;
    color: #ede6d4;
    font: 400 20px/1.4 var(--pub-display);
  }
  .scales {
    position: absolute;
    left: 45%;
    top: 103px;
    width: clamp(118px, 10vw, 150px);
    height: auto;
    rotate: 8deg;
    pointer-events: none;
    filter: drop-shadow(0 8px 18px #07170d44);
  }
  .plans-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 24px;
    padding-top: 30px;
    color: #d9e0cf;
    font-size: 13.5px;
  }
  .plans-foot a {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-height: 36px;
    font: 400 20px/1.3 var(--pub-display);
    color: #f6eeda;
    text-decoration: none;
  }
  .plans-foot a:hover {
    text-decoration: underline;
  }
  .always,
  .faq {
    display: grid;
    grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
    gap: 40px clamp(40px, 6vw, 110px);
    padding-block: var(--space);
  }
  .always h2 {
    position: sticky;
    top: 110px;
  }
  .always ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .always li {
    display: grid;
    align-items: center;
    grid-template-columns: 76px minmax(0, 1fr) minmax(0, 1.25fr);
    gap: 8px 28px;
    padding: 22px 0;
    border-top: 1px solid var(--rule);
  }
  .always li:last-child {
    border-bottom: 1px solid var(--rule);
  }
  .always img {
    max-width: 64px;
    max-height: 64px;
    object-fit: contain;
    filter: drop-shadow(0 7px 9px #5c512633);
  }
  .always h3 {
    font-size: 25px;
    line-height: 1.2;
  }
  .always p {
    color: #455346;
    font-size: 15.5px;
  }
  .compare {
    padding-bottom: var(--space);
  }
  .section-head {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 4fr);
    gap: 16px clamp(40px, 6vw, 110px);
    align-items: end;
    margin-bottom: 40px;
  }
  .section-head p,
  .faq-head p {
    font-size: 16px;
    color: var(--muted);
  }
  .faq {
    border-top: 1px solid var(--rule);
  }
  .faq-head {
    align-self: start;
    display: grid;
    gap: 16px;
  }
  .faq-head a {
    color: #244532;
    font-weight: 600;
  }
  .bookmark {
    margin-top: 28px;
    width: 92px;
    height: auto;
    rotate: -8deg;
    filter: drop-shadow(0 9px 7px #4c351d30);
  }
  .faq details {
    border-top: 1px solid var(--rule);
  }
  .faq details:last-child {
    border-bottom: 1px solid var(--rule);
  }
  .faq summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    min-height: 70px;
    cursor: pointer;
    padding: 22px 0;
    color: #1e3d2c;
    font: 400 23px/1.25 var(--pub-display);
    list-style: none;
  }
  .faq summary::-webkit-details-marker {
    display: none;
  }
  .faq summary:hover {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .faq summary :global(svg) {
    flex: none;
    transition: rotate 0.2s ease;
  }
  .faq details[open] summary :global(svg) {
    rotate: 45deg;
  }
  .faq details p {
    max-width: 44em;
    padding-bottom: 24px;
    font-size: 16px;
    line-height: 1.65;
    color: #425145;
  }
  .closing {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(240px, 380px);
    gap: 40px;
    align-items: center;
    padding: clamp(64px, 8vw, 112px) 5%;
  }
  .closing h2 {
    font-size: clamp(42px, 4.2vw, 64px);
  }
  .closing p {
    margin: 22px 0 30px;
    max-width: 30em;
    font-size: 19px;
    color: #e6e8d9;
  }
  .close-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }
  .demo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 22px;
    min-height: 54px;
    border: 1px solid #c8d9bf;
    border-radius: 8px;
    color: #f5ecd9;
    font: 400 20px/1.2 var(--pub-display);
    text-decoration: none;
  }
  .demo:hover {
    background: #ffffff12;
  }
  .clay-files {
    position: relative;
    align-self: stretch;
    min-height: 240px;
  }
  .clay-files img {
    position: absolute;
    height: auto;
    filter: drop-shadow(0 15px 12px #05160e60);
  }
  .clay-files img:first-child {
    width: clamp(170px, 15vw, 230px);
    top: 4%;
    left: 4%;
    rotate: -6deg;
  }
  .clay-files img:last-child {
    width: clamp(92px, 8vw, 120px);
    bottom: 0;
    right: 6%;
    rotate: 12deg;
  }
  .quick-nav {
    position: fixed;
    z-index: 35;
    top: 12px;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 18px;
    width: min(980px, calc(100% - 28px));
    min-height: 56px;
    padding: 5px 7px 5px 22px;
    background: #f8f2e7;
    color: #193729;
    border: 1px solid #dbd4c1;
    border-radius: 99px;
    box-shadow: 0 8px 28px #19332629;
    transform: translate(-50%, -150%);
    visibility: hidden;
  }
  .quick-nav.shown {
    visibility: visible;
    transform: translate(-50%, 0);
  }
  .quick-nav .word {
    font: 400 32px/1 var(--pub-display);
    letter-spacing: -0.05em;
  }
  .quick-nav a {
    color: inherit;
    text-decoration: none;
  }
  .quick-nav > div {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .quick-nav > div a {
    display: grid;
    align-items: center;
    min-height: 40px;
    font-size: 14px;
  }
  .quick-nav :global(.action) {
    margin-left: auto;
    border-radius: 99px;
  }
  @media (prefers-reduced-motion: no-preference) {
    .quick-nav.shown {
      animation: appear 0.22s ease-out;
    }
    @keyframes appear {
      from {
        opacity: 0;
        transform: translate(-50%, -20%);
      }
    }
  }
  @media (max-width: 1180px) {
    .pricing-intro {
      grid-template-columns: 1fr;
    }
    .terms {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 26px 40px;
      align-items: center;
    }
    .terms p {
      grid-column: 1/-1;
    }
    .scales {
      left: auto;
      right: 0;
    }
  }
  @media (max-width: 1100px) {
    .always,
    .faq {
      grid-template-columns: 1fr;
    }
    .always h2 {
      position: static;
    }
    .bookmark {
      display: none;
    }
  }
  @media (max-width: 900px) {
    .scales,
    .clay-files,
    .quick-nav > div {
      display: none;
    }
    .closing,
    .section-head {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 700px) {
    .pricing {
      --space: 64px;
    }
    .cloth {
      margin-inline: 8px;
      border-radius: 20px;
    }
    .pricing-cover {
      margin-top: 8px;
      padding: 0 20px 28px;
    }
    .pricing-intro {
      padding-top: clamp(116px, 16vh, 144px);
      padding-bottom: 44px;
    }
    .hero-copy h1 {
      font-size: clamp(38px, 10.4vw, 56px);
    }
    .hero-copy p {
      font-size: 17px;
    }
    .terms {
      grid-template-columns: 1fr;
    }
    .plans-foot {
      padding-top: 14px;
    }
    .always li {
      grid-template-columns: 56px minmax(0, 1fr);
    }
    .always img {
      width: 48px;
      height: 48px;
      grid-row: span 2;
    }
    .always p {
      grid-column: 2;
    }
    .faq summary {
      min-height: 66px;
      font-size: 20px;
    }
    .closing {
      padding: 56px 22px;
    }
    .demo {
      width: 100%;
    }
    .quick-nav {
      gap: 6px;
      padding-left: 17px;
    }
  }
</style>
