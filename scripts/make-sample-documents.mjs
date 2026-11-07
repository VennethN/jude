// Regenerate the seven fictional case exhibits and the filed Word original.
// Run from the repository with Node 22.13+, Playwright Chromium and LibreOffice.
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { documents, passages } from '../packages/core/src/server/seed.ts';

const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
const out = path.join(root, 'static/demo/documents');
const { chromium } = createRequire(path.join(root, 'package.json'))('@playwright/test');
const docs = Object.fromEntries(
  documents.map((d) => [d.id, { ...d, passages: passages.filter((p) => p.docId === d.id) }])
);
fs.mkdirSync(out, { recursive: true });
const SYNTH = 'CONTOH SINTETIS · Berkas latihan Jude';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const said = (d, page) => d.passages.filter((p) => p.page === page).map((p) => p.text);

const css = (family) => `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ${family}; color: #111; }
  .sheet { width: 210mm; height: 297mm; padding: 22mm 22mm 26mm; position: relative; page-break-after: always; overflow: hidden; }
  .sheet:last-child { page-break-after: auto; }
  .foot { position: absolute; left: 22mm; right: 22mm; bottom: 12mm; display: flex; justify-content: space-between; font: 8pt "Liberation Sans", sans-serif; color: #555; border-top: 0.5pt solid #999; padding-top: 2mm; }
  .synth { position: absolute; top: 9mm; right: 22mm; font: bold 7.5pt "Liberation Sans", sans-serif; color: #9a3d12; letter-spacing: 0.04em; }
  .kop { text-align: center; line-height: 1.25; border-bottom: 2pt double #111; padding-bottom: 3mm; margin-bottom: 7mm; }
  .kop b { display: block; font-size: 12pt; letter-spacing: 0.04em; }
  .kop span { font-size: 9.5pt; }
  h1 { font-size: 13pt; text-align: center; margin: 0 0 1.5mm; letter-spacing: 0.08em; }
  h2 { font-size: 11.5pt; text-align: center; margin: 0 0 7mm; text-decoration: underline; letter-spacing: 0.04em; }
  h3 { font-size: 11pt; margin: 6mm 0 2mm; }
  p { font-size: 11pt; line-height: 1.6; margin: 0 0 3.5mm; text-align: justify; }
  .qa { display: grid; grid-template-columns: 9mm 1fr; margin-bottom: 4mm; font-size: 11pt; line-height: 1.6; }
  .qa p { margin: 0 0 1mm; }
  .tag { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; margin: 2mm 0 5mm; }
  th, td { border: 0.6pt solid #444; padding: 1.6mm 2.2mm; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .idt td { border: 0; padding: 0.6mm 2mm 0.6mm 0; font-size: 11pt; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: 14mm; text-align: center; font-size: 11pt; }
  .sign .line { margin-top: 22mm; border-top: 0.6pt solid #111; padding-top: 1.5mm; }
  .figure { border: 0.6pt solid #444; margin: 3mm 0 2mm; }
  .caption { font-size: 9.5pt; color: #333; text-align: left; }
  .math { font-size: 13pt; text-align: center; margin: 4mm 0 5mm; }
  .mono { font-family: "Liberation Mono", monospace; font-size: 9pt; word-break: break-all; }
`;

function page(d, n, body, opts = {}) {
  return `<section class="sheet">
    <div class="synth">${SYNTH}</div>
    ${body}
    <div class="foot"><span>${esc(d.title)}</span><span>${opts.footer ?? `Halaman ${n} dari ${d.pages}`}</span></div>
  </section>`;
}

const kopPolisi = `<div class="kop"><b>KEPOLISIAN SEKTOR CONTOH</b><span>Jl. Teladan No. 1, Kota Contoh · Unit Reserse Kriminal</span></div>`;

function bap(d, saksi) {
  const questions = {
    d1p2: 'Di mana dan sejak kapan Saudara bekerja?',
    d1p3: 'Jelaskan kondisi area tempat Saudara bertugas.',
    d1p4: 'Kapan Saudara tiba di Gudang B pada hari Sabtu, 14 Maret 2026?',
    d1p5: 'Apa yang Saudara lihat menjelang tengah malam?',
    d1p6: 'Bagaimana Saudara melakukan dan mencatat patroli?',
    d2p1: 'Di mana dan sejak kapan Saudara bekerja?',
    d2p2: 'Siapa saja yang memegang kunci Gudang B?',
    d2p3: 'Kapan Saudara pulang dari gudang pada 14 Maret 2026?',
    d2p4: 'Kapan stock opname terakhir sebelum kejadian dilaksanakan?',
    d2p5: 'Bagaimana Saudara mengetahui adanya selisih barang?'
  };
  let sequence = 0;
  const answer = (q, a) =>
    `<div class="qa"><span>${++sequence}.</span><div><p><span class="tag">Pertanyaan:</span> ${esc(q)}</p><p><span class="tag">Jawaban:</span> ${esc(a)}</p></div></div>`;
  const pages = [];
  for (let n = 1; n <= d.pages; n++) {
    let body = '';
    if (n === 1) {
      body += kopPolisi + '<h1>PRO JUSTITIA</h1><h2>BERITA ACARA PEMERIKSAAN (SAKSI)</h2>';
      body += `<table class="idt"><tr><td>Nama</td><td>${esc(saksi.nama)}</td></tr><tr><td>Tempat/tgl. lahir</td><td>${esc(saksi.lahir)}</td></tr><tr><td>Pekerjaan</td><td>${esc(saksi.kerja)}</td></tr><tr><td>Alamat</td><td>${esc(saksi.alamat)}</td></tr></table>`;
    }
    for (const p of d.passages.filter((p) => p.page === n)) {
      if (p.id === 'd1p7')
        body += answer('Apakah masih ada keterangan lain yang hendak Saudara sampaikan?', 'Tidak ada.');
      body += questions[p.id] ? answer(questions[p.id], p.text) : `<p>${esc(p.text)}</p>`;
    }
    if (n === 5 && d.id === 'd1') {
      body +=
        '<h3>Catatan buku patroli</h3><table><tr><th>Waktu</th><th>Lokasi</th><th>Keterangan</th></tr><tr><td>20.35</td><td>Gerbang Timur</td><td>Aman</td></tr><tr><td>22.40</td><td>Area bongkar muat</td><td>Lampu sorot timur padam</td></tr><tr><td>00.50</td><td>Gudang B</td><td>Aman</td></tr><tr><td>02.55</td><td>Gerbang Timur</td><td>Aman</td></tr></table>';
    }
    if (n === d.pages && d.id === 'd1') {
      body += `<div class="sign"><div>Yang diperiksa,<div class="line">${esc(saksi.nama.toUpperCase())}</div></div><div>Penyidik,<div class="line">AIPTU CONTOH SAJA</div></div></div>`;
    }
    pages.push(page(d, n, body));
  }
  return pages.join('');
}

const cctvSvg = `<svg viewBox="0 0 640 360" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ilustrasi sintetis bingkai CCTV">
  <rect width="640" height="360" fill="#20262b"/>
  <rect x="0" y="250" width="640" height="110" fill="#2d3439"/>
  <rect x="40" y="120" width="160" height="150" fill="#3b444b"/>
  <rect x="440" y="90" width="200" height="180" fill="#353d43"/>
  <g transform="translate(230 170)">
    <rect x="0" y="0" width="190" height="80" rx="4" fill="#d9dcde"/>
    <rect x="190" y="25" width="55" height="55" rx="4" fill="#c4c8cb"/>
    <rect x="200" y="32" width="30" height="20" fill="#6d7a83"/>
    <circle cx="40" cy="85" r="14" fill="#111"/><circle cx="210" cy="85" r="14" fill="#111"/>
  </g>
  <rect x="0" y="0" width="640" height="30" fill="rgba(0,0,0,0.55)"/>
  <text x="12" y="20" fill="#f2f2f2" font-family="Liberation Mono" font-size="14">CAM-03 GERBANG TIMUR</text>
  <text x="628" y="20" fill="#f2f2f2" font-family="Liberation Mono" font-size="14" text-anchor="end">14-03-2026 23:48:12</text>
  <text x="12" y="350" fill="#bfc5c9" font-family="Liberation Sans" font-size="12">ILUSTRASI SINTETIS · bukan rekaman asli</text>
</svg>`;

const chartSvg = `<svg viewBox="0 0 520 220" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Grafik peristiwa gerbang per jam">
  <line x1="40" y1="190" x2="510" y2="190" stroke="#333"/><line x1="40" y1="20" x2="40" y2="190" stroke="#333"/>
  ${[
    ['18', 3],
    ['19', 2],
    ['20', 5],
    ['21', 1],
    ['22', 2],
    ['23', 4],
    ['00', 1],
    ['01', 0],
    ['02', 1]
  ]
    .map(
      ([h, v], i) =>
        `<rect x="${55 + i * 50}" y="${190 - v * 30}" width="30" height="${v * 30}" fill="#5c6f7d"/><text x="${70 + i * 50}" y="206" font-size="11" text-anchor="middle" font-family="Liberation Sans">${h}</text><text x="${70 + i * 50}" y="${184 - v * 30}" font-size="10" text-anchor="middle" font-family="Liberation Sans">${v}</text>`
    )
    .join('')}
  <text x="8" y="16" font-size="11" font-family="Liberation Sans">Peristiwa</text>
  <text x="510" y="218" font-size="11" text-anchor="end" font-family="Liberation Sans">Jam (WIB), 14–15 Maret 2026</text>
</svg>`;

function forensic(d) {
  const pages = [];
  const kop = `<div class="kop"><b>LABORATORIUM FORENSIK DIGITAL CONTOH</b><span>Laporan Pemeriksaan Barang Bukti Elektronik · No. LFD/CONTOH/03/2026</span></div>`;
  for (let n = 1; n <= d.pages; n++) {
    const texts = said(d, n);
    let body =
      n === 1
        ? kop + `<h1>LAPORAN LOG AKSES GERBANG &amp; CCTV</h1><h2>GUDANG B PT SINAR LOGISTIK CONTOH</h2>`
        : '';
    if (n === 1) {
      body += texts.map((t) => `<p>${esc(t)}</p>`).join('');
      body += `<h3>Ringkasan barang bukti</h3><table><tr><th>No.</th><th>Barang bukti</th><th>Jumlah</th></tr><tr><td>1</td><td>Server kontrol akses gerbang (ekspor log)</td><td>1 berkas</td></tr><tr><td>2</td><td>Perekam video jaringan (NVR) 4 kanal</td><td>1 unit</td></tr><tr><td>3</td><td>Buku patroli petugas jaga</td><td>1 buku</td></tr></table>`;
    } else if (n === 2) {
      body += `<h3>2. Integritas data</h3><p>Setiap berkas hasil ekstraksi dihitung nilai hash-nya sebelum dan sesudah pemeriksaan. Nilai yang sama menunjukkan berkas tidak berubah.</p><table><tr><th>Berkas</th><th>SHA-256</th></tr><tr><td>access_log_0314.csv</td><td class="mono">4f1c9e0a7b2d55e3c1a98f60b7d2e4c0a91f3b6e8d27c45a0e9b13f7c2d6a8e1</td></tr><tr><td>nvr_cam03_0314.mp4</td><td class="mono">b8e2d4f7a1c39e05d6f2b8a47c1e90d3f5a6b2c8e4d17f09a3c5b7e1d2f4a6c8</td></tr></table>`;
    } else if (n === 3) {
      body += `<h3>3. Sinkronisasi waktu</h3><p>Jam perekam video dibandingkan dengan server waktu (NTP). Selisih waktu dihitung dan diterapkan pada setiap rekaman:</p>
      <div class="math"><math display="block"><mrow><mi>Δ</mi><mi>t</mi><mo>=</mo><msub><mi>t</mi><mtext>NVR</mtext></msub><mo>−</mo><msub><mi>t</mi><mtext>NTP</mtext></msub><mo>=</mo><mo>+</mo><mn>72</mn><mtext> s</mtext></mrow></math></div>
      <div class="math"><math display="block"><mrow><msub><mi>t</mi><mtext>terkoreksi</mtext></msub><mo>=</mo><msub><mi>t</mi><mtext>NVR</mtext></msub><mo>−</mo><mi>Δ</mi><mi>t</mi></mrow></math></div>
      <p>Seluruh waktu rekaman dalam laporan ini telah dikoreksi. Waktu kartu akses berasal dari server yang tersinkron dengan NTP dan tidak dikoreksi.</p>`;
    } else if (n === 7) {
      body += `<h3>7. Log kartu akses Gerbang Timur, 14 Maret 2026</h3><table><tr><th>Waktu</th><th>Kartu</th><th>Gerbang</th><th>Peristiwa</th></tr><tr><td>18:41:05</td><td>D. Prasetyo</td><td>Timur</td><td>Keluar</td></tr><tr><td>20:07:41</td><td>R. Hartati</td><td>Timur</td><td>Masuk</td></tr><tr><td>20:12:18</td><td>Y. Saputra</td><td>Timur</td><td>Keluar</td></tr></table>`;
      body += texts.map((t) => `<p>${esc(t)}</p>`).join('');
    } else if (n === 8) {
      body += `<h3>8. Cuplikan rekaman CAM-03</h3><div class="figure">${cctvSvg}</div><p class="caption">Gambar 8.1. Cuplikan rekaman kamera Gerbang Timur (waktu terkoreksi).</p>`;
      body += texts.map((t) => `<p>${esc(t)}</p>`).join('');
    } else if (n === 10) {
      body += `<h3>10. Patroli dan aktivitas gerbang</h3><div class="figure">${chartSvg}</div><p class="caption">Gambar 10.1. Jumlah peristiwa kartu akses dan kendaraan per jam.</p>`;
      body += texts.map((t) => `<p>${esc(t)}</p>`).join('');
    } else if (n === d.pages) {
      body += texts.map((t) => `<p>${esc(t)}</p>`).join('');
      body += `<p>Demikian laporan ini dibuat dengan sebenarnya untuk dipergunakan seperlunya.</p><div class="sign"><div></div><div>Analis Forensik Digital,<div class="line">CONTOH ANALIS, S.Kom.</div></div></div>`;
    } else {
      body += texts.map((t) => `<p>${esc(t)}</p>`).join('');
      if (!texts.length)
        body += `<h3>${n}. Lanjutan pemeriksaan</h3><p>Rincian metode ekstraksi dan daftar kanal kamera yang diperiksa. Pemeriksaan mencakup catatan gerbang dan rekaman kamera yang tercantum pada daftar barang bukti.</p>`;
    }
    pages.push(page(d, n, body));
  }
  return pages.join('');
}

function generic(d, kop, heading) {
  const pages = [];
  for (let n = 1; n <= d.pages; n++) {
    const texts = said(d, n);
    let body = n === 1 ? kop + heading : '';
    body += texts.map((t) => `<p>${esc(t)}</p>`).join('');
    if (d.id === 'd5' && n === 3)
      body += `<table><tr><th>Barang</th><th>Tercatat</th><th>Dihitung</th><th>Selisih</th></tr><tr><td>Televisi 43 inci</td><td>210</td><td>142</td><td>68</td></tr><tr><td>Pengeras suara aktif</td><td>164</td><td>112</td><td>52</td></tr><tr><td><b>Jumlah</b></td><td>374</td><td>254</td><td><b>120</b></td></tr></table>`;
    if (d.id === 'd5' && n === d.pages)
      body += `<div class="sign"><div>Supervisor Gudang,<div class="line">DIMAS PRASETYO</div></div><div>Bagian Keuangan,<div class="line">CONTOH PETUGAS</div></div></div>`;
    if (!texts.length && !(d.id === 'd5' && n === d.pages))
      body += `<p>Lembar lanjutan administrasi perkara.</p>`;
    pages.push(page(d, n, body, {}));
  }
  return pages.join('');
}

function chatHtml(n, d) {
  const quote = said(d, n)[0];
  const msgs = quote
    ? [
        ['Admin Arisan Contoh', quote, false],
        ['Anggota 7', 'Kok diundur lagi, Bu? Sudah dua kali.', true],
        ['Admin Arisan Contoh', 'Mohon sabar ya, dananya masih diputar.', false]
      ]
    : [
        ['Anggota ' + ((n % 9) + 2), `Setoran bulan ke-${n} sudah saya transfer.`, true],
        ['Admin Arisan Contoh', 'Terima kasih, sudah masuk.', false]
      ];
  return `<html><head><meta charset="utf-8"><style>
    body { margin: 0; width: 420px; background: #e9e4dc; font-family: "Liberation Sans", sans-serif; }
    .bar { background: #2f5d50; color: #fff; padding: 14px 16px; font-size: 15px; }
    .day { text-align: center; margin: 12px; font-size: 12px; color: #555; }
    .m { max-width: 300px; margin: 8px 12px; padding: 8px 10px; border-radius: 8px; background: #fff; font-size: 14px; line-height: 1.35; }
    .m.me { margin-left: auto; background: #d8f0c8; }
    .who { font-size: 12px; font-weight: bold; color: #2f5d50; margin-bottom: 3px; }
    .note { margin: 14px 12px; font-size: 11px; color: #8a3a14; font-weight: bold; }
  </style></head><body>
    <div class="bar">Grup Arisan Contoh · 32 anggota</div>
    <div class="day">${n === 6 ? '2 Februari 2026' : `${n} Januari 2026`}</div>
    ${msgs.map(([who, text, me]) => `<div class="m ${me ? 'me' : ''}"><div class="who">${esc(who)}</div>${esc(text)}</div>`).join('')}
    <div class="note">TANGKAPAN LAYAR SINTETIS · bukan percakapan asli</div>
  </body></html>`;
}

async function indictment(d) {
  const sections = [
    [
      'Surat Dakwaan',
      'Kejaksaan Negeri Contoh. Nomor register PDM-112/2026. Perkara atas nama Budi Santoso.',
      ...said(d, 1)
    ],
    [
      'Waktu dan tempat',
      ...said(d, 2),
      'Lokasi yang disebutkan dalam berkas adalah Gudang B PT Sinar Logistik Contoh.'
    ],
    [
      'Barang yang disebut dalam dakwaan',
      ...said(d, 3),
      'Berkas inventaris mencantumkan televisi 43 inci dan perangkat audio.'
    ],
    [
      'Daftar berkas pemeriksaan',
      'Berita Acara Pemeriksaan Saksi Rina Hartati.',
      'Berita Acara Pemeriksaan Saksi Dimas Prasetyo.'
    ],
    [
      'Berkas elektronik',
      'Laporan Log Akses Gerbang & CCTV. Daftar barang pemeriksaan memuat server kontrol akses dan perekam video jaringan.'
    ],
    [
      'Berita acara persediaan',
      'Berita Acara Stock Opname Gudang B. Lampiran memuat catatan penghitungan dan rincian selisih per jenis barang.'
    ],
    [
      'Daftar keterangan',
      'Keterangan Rina Hartati mengenai jadwal kerja dan patroli.',
      'Keterangan Dimas Prasetyo mengenai penghitungan dan akses gudang.'
    ],
    ['Uraian pasal dalam berkas', ...said(d, 8)],
    [
      'Penutup',
      'Berkas dakwaan sintetis ini disusun untuk pemeriksaan bersama bahan perkara contoh.',
      'Kejaksaan Negeri Contoh',
      'Penuntut Umum Contoh'
    ]
  ];
  const text = (style, value) => `<text:p text:style-name="${style}">${esc(value)}</text:p>`;
  const body = sections
    .map(
      ([heading, ...paragraphs], i) =>
        text(i ? 'PageHeading' : 'Title', heading) + paragraphs.map((p) => text('Body', p)).join('')
    )
    .join('');
  const style = (name, size, extra = '', before = '') =>
    `<style:style style:name="${name}" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.3cm" ${before}/><style:text-properties style:font-name="Liberation Serif" fo:font-size="${size}pt" ${extra}/></style:style>`;
  const fodt = `<?xml version="1.0" encoding="UTF-8"?>
<office:document office:mimetype="application/vnd.oasis.opendocument.text" office:version="1.3" xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">
<office:font-face-decls><style:font-face style:name="Liberation Serif" svg:font-family="Liberation Serif"/></office:font-face-decls>
<office:styles>${style('Title', 19, 'fo:font-weight="bold"')}${style('PageHeading', 15, 'fo:font-weight="bold"', 'fo:break-before="page"')}${style('Body', 11, '', 'fo:line-height="148%"')}${style('Label', 9, 'fo:font-weight="bold"')}</office:styles>
<office:automatic-styles><style:page-layout style:name="A4"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin="2.3cm"/><style:header-style><style:header-footer-properties fo:min-height="1.1cm"/></style:header-style><style:footer-style><style:header-footer-properties fo:min-height="1.1cm"/></style:footer-style></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="A4"><style:header>${text('Label', SYNTH)}</style:header><style:footer><text:p text:style-name="Label">PDM-112/2026   ·   Halaman <text:page-number/> dari <text:page-count/></text:p></style:footer></style:master-page></office:master-styles>
<office:body><office:text>${body}</office:text></office:body></office:document>`;
  const folder = fs.mkdtempSync(path.join(tmpdir(), 'jude-example-'));
  const profile = pathToFileURL(path.join(folder, 'profile')).href;
  const convert = (file, format) =>
    execFileSync(
      process.env.JUDE_SOFFICE || 'soffice',
      ['-env:UserInstallation=' + profile, '--headless', '--convert-to', format, '--outdir', out, file],
      { timeout: 45000, stdio: 'pipe' }
    );
  try {
    fs.writeFileSync(path.join(folder, 'd4.fodt'), fodt);
    convert(path.join(folder, 'd4.fodt'), 'docx:Office Open XML Text');
    convert(path.join(out, 'd4.docx'), 'pdf:writer_pdf_Export');
  } finally {
    fs.rmSync(folder, { force: true, recursive: true });
  }
}

(async () => {
  const browser = await chromium.launch(
    process.env.JUDE_CHROME_CHANNEL ? { channel: process.env.JUDE_CHROME_CHANNEL } : {}
  );
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const saksi = {
    d1: {
      nama: 'Rina Hartati',
      lahir: 'Kota Contoh, 3 Mei 1994',
      kerja: 'Petugas keamanan',
      alamat: 'Jl. Contoh Raya No. 12, Kota Contoh'
    },
    d2: {
      nama: 'Dimas Prasetyo',
      lahir: 'Kota Contoh, 19 Agustus 1988',
      kerja: 'Supervisor gudang',
      alamat: 'Jl. Teladan Indah No. 5, Kota Contoh'
    }
  };
  for (const [id, d] of Object.entries(docs)) {
    if (id === 'd4') {
      await indictment(d);
      continue;
    }
    let html;
    if (id === 'd1' || id === 'd2') html = bap(d, saksi[id]);
    else if (id === 'd3') html = forensic(d);
    else if (id === 'd5')
      html = generic(
        d,
        `<div class="kop"><b>PT SINAR LOGISTIK CONTOH</b><span>Gudang B · Kota Contoh</span></div>`,
        `<h1>BERITA ACARA</h1><h2>STOCK OPNAME GUDANG B</h2>`
      );
    else if (id === 'd6')
      html = generic(d, kopPolisi, `<h1>LAPORAN POLISI</h1><h2>NOMOR: LP/B/0451/2026</h2>`);
    if (id === 'd7') {
      // Screenshots only: each page is a picture, so the PDF has no text layer.
      const shots = [];
      const shot = await ctx.newPage();
      await shot.setViewportSize({ width: 420, height: 640 });
      for (let n = 1; n <= d.pages; n++) {
        await shot.setContent(chatHtml(n, d));
        shots.push((await shot.screenshot({ type: 'png' })).toString('base64'));
      }
      await shot.close();
      html = shots
        .map(
          (b64, i) =>
            `<section class="sheet" style="padding:18mm 30mm 26mm;display:grid;place-items:start center"><div class="synth">${SYNTH}</div><img alt="Percakapan sintetis" src="data:image/png;base64,${b64}" style="width:120mm"><div class="foot"><span>${esc(d.title)}</span><span>Halaman ${i + 1} dari ${d.pages} · tangkapan layar</span></div></section>`
        )
        .join('');
    }
    const family =
      id === 'd3' || id === 'd5'
        ? `"Liberation Sans", Arial, sans-serif`
        : `"Liberation Serif", "Times New Roman", serif`;
    await p.setContent(
      `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>${css(family)}</style></head><body>${html}</body></html>`,
      { waitUntil: 'load' }
    );
    const file = path.join(out, `${id}.pdf`);
    await p.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true });
    console.log(id, d.pages, 'pages', fs.statSync(file).size, 'bytes');
  }
  await browser.close();
})();
