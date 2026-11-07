<script lang="ts">
  import type { PageProps } from './$types';
  import CyclePicker from '$lib/public/CyclePicker.svelte';
  import PlanList from '$lib/public/PlanList.svelte';
  import SalesContact from '$lib/public/SalesContact.svelte';
  import Icon from '$lib/public/Icon.svelte';
  import { currency, featureNames, localized, quotaNames, quotaOrder } from '@jude/core/plans';
  let { data, form }: PageProps = $props();
  let isId = $derived(data.lang === 'id');
  let contactForm: SalesContact;
  let pro = $derived(data.plans.find((plan) => plan.id === 'pro'));
  let chosen = $derived(data.target || data.session?.plan.id || 'pro');
  const features = [
    'live_transcription',
    'response_suggestions',
    'jude_export',
    'team_sharing',
    'case_roles',
  ] as const;
  const faq = [
    {
      q: localized('Bagaimana uji coba bekerja?', 'How does the trial work?'),
      a: localized(
        'Uji coba Advokat Pro atau Firma berlangsung 14 hari tanpa kartu. Setelah itu akun kembali ke Dasar, kecuali Anda memilih paket berbayar.',
        'The Advocate Pro or Firm trial lasts 14 days without a card. The account then returns to Basic unless you choose a paid plan.',
      ),
    },
    {
      q: localized('Apa yang dihitung sebagai jam transkripsi?', 'What counts towards transcription hours?'),
      a: localized(
        'Durasi sidang yang direkam dan audio yang diunggah. Transkrip teks yang diimpor tidak memakai jam transkripsi.',
        'Recorded hearings and uploaded audio count by duration. Imported text transcripts use no transcription hours.',
      ),
    },
    {
      q: localized(
        'Apakah berkas saya tetap tersimpan saat berganti paket?',
        'Do I keep my files if I change plans?',
      ),
      a: localized(
        'Berkas yang ada tetap tersimpan. Bila pemakaian melampaui batas baru, kurangi pemakaian sebelum menambah materi baru.',
        'Existing files are kept. If usage exceeds a new limit, reduce usage before adding more material.',
      ),
    },
    {
      q: localized('Apakah kutipan ikut diterjemahkan?', 'Are quotations translated as well?'),
      a: localized(
        'Antarmuka tersedia dalam Bahasa Indonesia dan Inggris. Dokumen asli dan keterangan di sidang selalu ditampilkan dalam bahasa asalnya.',
        'The interface is available in Indonesian and English. Original documents and testimony are always shown in the language of the record.',
      ),
    },
  ];
</script>

<svelte:head
  ><title>{isId ? 'Paket dan harga' : 'Plans and pricing'} · Jude</title><meta
    name="description"
    content={isId
      ? 'Bandingkan paket dan kuota ruang kerja Jude.'
      : 'Compare plans and quotas for the Jude case workspace.'}
  /></svelte:head
>
<div class="pricing-cover">
  <section class="pub-frame pricing-intro">
    <div class="pricing-copy">
      <h1>
        {isId ? 'Harga yang jelas,' : 'Clear pricing,'}<br />{isId
          ? 'untuk setiap jam sidang.'
          : 'for every hearing hour.'}
      </h1>
      <p>
        {isId
          ? 'Mulai gratis dengan Dasar, atau coba Advokat Pro 14 hari tanpa kartu. Di paket apa pun, setiap temuan datang dengan sumbernya.'
          : 'Start free with Basic, or try Advocate Pro for 14 days without a card. Every plan includes the sources behind each finding.'}
      </p>
    </div>
    <div class="terms">
      <CyclePicker lang={data.lang} cycle={data.cycle} cover />
      <ul>
        <li>
          <Icon name="check" size={15} />{isId
            ? '14 hari gratis, tanpa kartu kredit'
            : '14 days free, no credit card'}
        </li>
        <li>
          <Icon name="check" size={15} />{isId
            ? 'Ganti atau berhenti kapan saja'
            : 'Change or cancel anytime'}
        </li>
        <li>
          <Icon name="check" size={15} />{isId ? 'Paket Dasar gratis selamanya' : 'Basic is always free'}
        </li>
      </ul>
      {#if pro?.quotas.hours}<p class="hour-rate">
          {pro.name[data.lang]}
          {data.cycle === 'yearly'
            ? isId
              ? 'ditagih tahunan'
              : 'billed yearly'
            : isId
              ? 'ditagih bulanan'
              : 'billed monthly'}<br />{isId ? 'sekitar' : 'about'}
          {currency(
            Math.round(
              (data.cycle === 'yearly' ? (pro.yearlyPerMonth ?? 0) : (pro.monthly ?? 0)) /
                pro.quotas.hours /
                100,
            ) * 100,
            data.lang,
          )}
          {isId ? 'per jam sidang.' : 'per hearing hour.'}
        </p>{/if}
    </div>
  </section>
  <section class="pub-frame plans" id="plans" aria-label={isId ? 'Paket ruang kerja' : 'Workspace plans'}>
    <PlanList
      plans={data.plans}
      lang={data.lang}
      cycle={data.cycle}
      signedIn={Boolean(data.session && !data.session.user.guest)}
      selected={data.target}
      contact={() => contactForm.open()}
    />
  </section>
</div>
<section class="pub-frame common-ground">
  <div>
    <h2>{isId ? 'Di paket apa pun, sumbernya selalu terlihat.' : 'Every plan keeps its sources in view.'}</h2>
    <p>
      {isId
        ? 'Buka temuan untuk membaca kata-kata saksi dan halaman dokumen yang dirujuk.'
        : 'Open a finding to read the witness’s words alongside the cited document page.'}
    </p>
    <small
      >{isId
        ? 'Harga contoh dalam rupiah. Tagihan disimulasikan.'
        : 'Example prices in rupiah. Billing is simulated.'}</small
    >
  </div>
  <img src="/public/clay/scales.webp" alt="" loading="lazy" decoding="async" width="150" height="135" />
</section>
<div class="pub-frame compare">
  <h2>{isId ? 'Bandingkan kapasitas.' : 'Compare capacity.'}</h2>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users scroll the wide comparison inside this region.) -->
  <div
    class="table-wrap"
    role="region"
    aria-label={isId ? 'Perbandingan paket' : 'Plan comparison'}
    tabindex="0"
  >
    <table>
      <caption class="visually-hidden"
        >{isId ? 'Fitur dan batas menurut paket' : 'Feature and quota comparison by plan'}</caption
      >
      <thead
        ><tr
          ><th scope="col">{isId ? 'Per paket' : 'Per plan'}</th>{#each data.plans as plan}<th
              scope="col"
              class:chosen={chosen === plan.id}>{plan.name[data.lang]}</th
            >{/each}</tr
        ></thead
      >
      <tbody
        >{#each quotaOrder as key}<tr
            ><th scope="row">{quotaNames[key][data.lang]}</th>{#each data.plans as plan}<td
                class:chosen={chosen === plan.id}
                >{plan.quotas[key] === null
                  ? isId
                    ? 'Tanpa batas'
                    : 'Unlimited'
                  : new Intl.NumberFormat(isId ? 'id-ID' : 'en-US').format(plan.quotas[key]!)}</td
              >{/each}</tr
          >{/each}
        {#each features as key}<tr
            ><th scope="row">{featureNames[key][data.lang]}</th>{#each data.plans as plan}<td
                class:chosen={chosen === plan.id}
                >{#if plan.features.includes(key)}<Icon name="check" size={17} /><span class="visually-hidden"
                    >{isId ? 'Termasuk' : 'Included'}</span
                  >{:else}<span aria-hidden="true">—</span><span class="visually-hidden"
                    >{isId ? 'Di luar paket' : 'Not included'}</span
                  >{/if}</td
              >{/each}</tr
          >{/each}</tbody
      >
    </table>
  </div>
</div>
<section class="pub-frame faq">
  <h2>{isId ? 'Tentang paket Jude.' : 'About Jude’s plans.'}</h2>
  <div>
    {#each faq as row}<details name="pricing-questions">
        <summary>{row.q[data.lang]}<Icon name="chevron" size={18} /></summary>
        <p>{row.a[data.lang]}</p>
      </details>{/each}
  </div>
</section>
<SalesContact
  bind:this={contactForm}
  lang={data.lang}
  initial={data.showContact}
  result={form}
  profile={data.session && !data.session.user.guest ? data.session.user : null}
/>

<style>
  .compare h2,
  .faq h2 {
    font-size: clamp(2.3rem, 3.8vw, 3.8rem);
  }
  .faq p {
    margin: 0 0 17px;
    color: #526052;
    font-size: 0.9rem;
    line-height: 1.65;
  }
  .compare {
    padding-block: 14px 50px;
  }
  .table-wrap {
    position: relative;
    margin-top: 25px;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    font: 0.87rem/1.4 var(--pub-record);
  }
  th,
  td {
    text-align: center;
    padding: 13px 10px;
    border-bottom: 1px solid #d2d4c8;
  }
  th:first-child {
    text-align: left;
    font-weight: 400;
  }
  thead th {
    background: #e8ebdf;
    color: #2d472f;
    position: sticky;
    top: 0;
    z-index: 1;
    font: 600 0.88rem/1.4 var(--pub-body);
  }
  .chosen {
    background: #ece7d8;
  }
  thead .chosen {
    background: #e5dbc0;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .faq {
    padding-block: 45px 75px;
    display: grid;
    grid-template-columns: 0.8fr 1.2fr;
    gap: 50px;
  }
  .faq details {
    border-bottom: 1px solid #cbd0c1;
  }
  .faq details:first-child {
    border-top: 1px solid #cbd0c1;
  }
  .faq summary {
    list-style: none;
    min-height: 60px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 18px;
    cursor: pointer;
    font-weight: 600;
  }
  .faq summary::-webkit-details-marker {
    display: none;
  }
  .faq details[open] :global(svg) {
    transform: rotate(180deg);
  }
  @media (max-width: 760px) {
    .faq {
      grid-template-columns: 1fr;
      gap: 20px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      min-width: 650px;
    }
    th:first-child {
      position: sticky;
      left: 0;
      background: #f7f4e9;
      max-width: 140px;
    }
    thead th:first-child {
      z-index: 2;
    }
    .faq {
      padding-block: 30px 55px;
    }
  }

  .pricing-cover {
    position: relative;
    margin: 14px 14px 0;
    border-radius: 28px;
    overflow: hidden;
    color: #f9f2e3;
    background-color: #142f26;
    background-image:
      radial-gradient(125% 95% at top left, rgb(98 160 124 / .3), rgb(98 160 124 / .1) 38%, transparent 68%),
      radial-gradient(110% 85% at bottom right, rgb(2 13 8 / .45), transparent 66%),
      url('/public/case-cloth.webp');
    background-repeat: no-repeat, no-repeat, repeat;
    background-size: 100% 100%, 100% 100%, 1300px auto;
  }
  .pricing-cover:before {
    content: '';
    pointer-events: none;
    position: absolute;
    inset: 0;
    background: repeating-radial-gradient(
      circle at 102% -5%,
      transparent 0 38px,
      #f3e4bf23 39px,
      transparent 40px
    );
    mask-image: linear-gradient(225deg, #000, transparent 39%);
  }
  .pricing-cover .pub-frame {
    position: relative;
    width: min(calc(100% - clamp(48px, 10vw, 140px)), 1320px);
  }
  .pricing-intro {
    display: grid;
    padding-block: clamp(137px, 11.5vw, 168px) clamp(54px, 6.55vw, 95px);
    grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
    gap: clamp(28px, 6vw, 86px);
    align-items: end;
  }
  .pricing-intro h1 {
    max-width: 24ch;
    font:
      400 clamp(2.65rem, 4.8vw, 4.7rem)/1.03 Rufina,
      Georgia,
      serif;
    letter-spacing: -0.035em;
  }
  .pricing-copy p {
    margin-top: 24px;
    max-width: 56ch;
    color: #e0e7da;
    font-size: 1.16rem;
    line-height: 1.6;
  }
  .terms {
    display: grid;
    gap: 15px;
  }
  .terms ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 9px;
  }
  .terms li {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 1rem;
  }
  .terms li :global(svg) {
    color: #edc276;
  }
  .pricing-intro .hour-rate {
    margin: 0;
    border-top: 1px solid #dce5d247;
    padding-top: 14px;
    font: 400 1.38rem/1.35 var(--pub-display);
    color: #f7efdb;
  }
  .plans {
    padding: 0 0 clamp(32px, 5vw, 65px);
  }
  .common-ground {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding-block: clamp(38px, 6vw, 82px);
  }
  .common-ground h2 {
    font-size: clamp(2.1rem, 4vw, 3.9rem);
    max-width: 24ch;
  }
  .common-ground p {
    margin-top: 13px;
    max-width: 58ch;
  }
  .common-ground small {
    display: block;
    color: #576356;
    margin-top: 8px;
  }
  .common-ground img {
    width: clamp(88px, 15vw, 175px);
    height: auto;
  }
  @media (max-width: 760px) {
    .pricing-cover {
      margin: 8px 8px 0;
      border-radius: 17px;
    }
    .pricing-cover .pub-frame {
      width: calc(100% - 40px);
    }
    .pricing-intro {
      grid-template-columns: 1fr;
      padding-block: 122px 52px;
      gap: 30px;
    }
    .pricing-copy p {
      font-size: 1.05rem;
      margin-top: 23px;
    }
    .terms {
      gap: 15px;
    }
    .common-ground {
      align-items: flex-start;
    }
    .common-ground img {
      width: 64px;
    }
  }
</style>
