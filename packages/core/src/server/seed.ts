import type {
  CaseDocument,
  CaseRecord,
  Connection,
  Finding,
  Hearing,
  LegalRef,
  Passage,
  Speaker,
  Statement,
} from "../domain";

/**
 * Synthetic case material. Every person, company, reference and document
 * here is invented. Testimony and documents stay in Indonesian (the courtroom language);
 * finding text is written in both interface languages. Legal entries imitate Pasal.id
 * discovery metadata and are summaries, not official statute text.
 */

export const TODAY = "2026-11-04";

export const cases: CaseRecord[] = [
  {
    id: "c1",
    title: "Perkara Penggelapan Gudang Cakung",
    reference: "112/Pid.B/2026/PN Contoh",
    label: "synthetic",
    summary: {
      id: "Dugaan penggelapan dalam jabatan atas 120 karton barang elektronik dari Gudang B. Anda mendampingi Terdakwa Budi Santoso.",
      en: "Alleged embezzlement in office of 120 cartons of electronics from Warehouse B. You represent the defendant, Budi Santoso.",
    },
    client: "Budi Santoso",
    court: "Pengadilan Negeri Contoh",
    updated: "2026-11-04",
    nextHearing: {
      date: "2026-11-11",
      time: "09.00",
      title: {
        id: "Sidang 4 · Pemeriksaan saksi meringankan",
        en: "Hearing 4 · Defense witness examination",
      },
    },
  },
  {
    id: "c2",
    title: "Perkara Penipuan Arisan Daring",
    reference: "087/Pid.Sus/2026/PN Contoh",
    label: "synthetic",
    summary: {
      id: "Dugaan penipuan dana arisan daring senilai Rp45 juta. Berkas awal sudah masuk; belum ada sidang.",
      en: "Alleged online savings-group fraud of Rp45 million. Initial documents are in; no hearings yet.",
    },
    client: "Sari Wulandari",
    court: "Pengadilan Negeri Contoh",
    updated: "2026-10-29",
  },
  {
    id: "c3",
    title: "Perkara Pencurian Kendaraan Bekasi",
    reference: "",
    label: "synthetic",
    summary: {
      id: "Perkara baru. Belum ada berkas atau sidang.",
      en: "New case. No documents or hearings yet.",
    },
    client: "—",
    court: "Pengadilan Negeri Contoh",
    updated: "2026-11-03",
  },
];

export const speakers: Speaker[] = [
  { id: "hk", label: "Hakim Ketua", role: "judge", confirmed: true },
  { id: "ha", label: "Hakim Anggota", role: "judge_member", confirmed: true },
  // Roles are seen from the lawyer's side: you defend Budi Santoso, so the prosecutor is opposing counsel.
  { id: "pu", label: "Penuntut Umum", role: "opposing", confirmed: true },
  { id: "ph", label: "Penasihat Hukum", role: "counsel", confirmed: true },
  { id: "rina", label: "Saksi Rina Hartati", role: "witness", confirmed: true },
  { id: "dimas", label: "Saksi Dimas Prasetyo", role: "witness", confirmed: true },
  { id: "tdw", label: "Terdakwa Budi Santoso", role: "party", confirmed: true },
  { id: "v3", label: "", role: "unknown", confirmed: false },
  { id: "v4", label: "", role: "unknown", confirmed: false },
];

export const hearings: Hearing[] = [
  {
    id: "h1",
    caseId: "c1",
    number: 1,
    title: { id: "Pembacaan dakwaan", en: "Reading of the indictment" },
    date: "2026-10-07",
    mode: "imported",
    duration: 840,
  },
  {
    id: "h2",
    caseId: "c1",
    number: 2,
    title: { id: "Pemeriksaan saksi Rina Hartati", en: "Examination of witness Rina Hartati" },
    date: "2026-10-21",
    mode: "recorded",
    duration: 4360,
  },
  {
    id: "h3",
    caseId: "c1",
    number: 3,
    title: { id: "Pemeriksaan saksi Dimas Prasetyo", en: "Examination of witness Dimas Prasetyo" },
    date: "2026-11-04",
    mode: "live",
    time: "09.30",
  },
  {
    id: "h4",
    caseId: "c1",
    number: 4,
    title: { id: "Pemeriksaan saksi meringankan", en: "Defense witness examination" },
    date: "2026-11-11",
    mode: "scheduled",
    time: "09.00",
  },
];

const st = (
  id: string,
  hearingId: string,
  speakerId: string,
  t: number,
  text: string,
  extra: Partial<Statement> = {},
): Statement => ({ id, hearingId, speakerId, t, text, phase: "complete", ...extra });

export const statements: Statement[] = [
  // Hearing 1 · imported risalah (procedural, no findings)
  st("s101", "h1", "hk", 40, "Sidang perkara pidana Nomor 112/Pid.B/2026/PN Contoh atas nama Terdakwa Budi Santoso dibuka dan terbuka untuk umum."),
  st("s102", "h1", "hk", 95, "Terdakwa, apakah Saudara dalam keadaan sehat dan siap mengikuti persidangan?"),
  st("s103", "h1", "tdw", 101, "Sehat, Yang Mulia. Siap."),
  st("s104", "h1", "hk", 180, "Saudara Penuntut Umum, silakan bacakan surat dakwaan."),
  st("s105", "h1", "pu", 210, "Bahwa Terdakwa Budi Santoso pada hari Sabtu tanggal 14 Maret 2026 sekitar pukul 22.00 WIB bertempat di Gudang B PT Sinar Logistik Contoh, dengan sengaja dan melawan hukum memiliki barang yang ada dalam kekuasaannya karena hubungan kerja."),
  st("s106", "h1", "pu", 640, "Perbuatan Terdakwa sebagaimana diatur dan diancam pidana dalam Pasal 374 KUHP.", { legal: ["lg3"] }),
  st("s107", "h1", "hk", 700, "Terdakwa, apakah Saudara mengerti isi dakwaan tadi?"),
  st("s108", "h1", "tdw", 712, "Mengerti, Yang Mulia."),
  st("s109", "h1", "ph", 760, "Yang Mulia, kami akan mengajukan eksepsi secara tertulis pada sidang berikutnya."),
  st("s110", "h1", "hk", 820, "Baik. Sidang ditunda dua minggu untuk pemeriksaan saksi."),

  // Hearing 2 · recorded audio, reviewed with findings
  st("s201", "h2", "hk", 70, "Sidang dibuka dan terbuka untuk umum. Saudara Penuntut Umum, silakan hadirkan saksi."),
  st("s202", "h2", "pu", 125, "Kami hadirkan saksi Rina Hartati, Yang Mulia."),
  st("s203", "h2", "hk", 210, "Saudara saksi, sebelum memberikan keterangan Saudara akan disumpah menurut agama Saudara. Apakah Saudara bersedia?"),
  st("s204", "h2", "rina", 228, "Bersedia, Yang Mulia."),
  st("s205", "h2", "pu", 372, "Saudara saksi bekerja di mana dan sejak kapan?"),
  st("s206", "h2", "rina", 380, "Saya satpam di Gudang B, sejak awal tahun 2024. Jaganya shift malam, jam delapan sampai jam delapan pagi."),
  st("s207", "h2", "pu", 835, "Pada hari Sabtu, 14 Maret 2026, jam berapa Saudara tiba di gudang?"),
  st("s208", "h2", "rina", 872, "Saya sampai di gudang jam setengah sepuluh malam, Pak."),
  st("s209", "h2", "pu", 890, "Setengah sepuluh? Bukan jam delapan?"),
  st("s210", "h2", "rina", 902, "Seingat saya setengah sepuluh, Pak. Karena saya sempat mampir dulu."),
  st("s211", "h2", "pu", 1060, "Seberapa sering Saudara melakukan patroli malam itu?"),
  st("s212", "h2", "rina", 1082, "Patroli setiap satu jam sekali, Pak, keliling gudang."),
  st("s213", "h2", "pu", 1335, "Siapa yang Saudara gantikan malam itu?"),
  st("s214", "h2", "rina", 1350, "Pak Yusuf, satpam shift sore. Dia pulang setelah saya datang."),
  st("s215", "h2", "pu", 1840, "Apa yang Saudara lihat menjelang tengah malam?"),
  st("s216", "h2", "rina", 1865, "Ada truk boks putih keluar lewat gerbang timur, menjelang tengah malam."),
  st("s217", "h2", "pu", 1990, "Saudara melihat siapa yang mengemudikan truk itu?"),
  st("s218", "h2", "rina", 2020, "Saya tidak melihat siapa yang mengemudikan, lampunya mati."),
  st("s219", "h2", "rina", 2120, "Tapi biasanya yang bawa truk itu orangnya Pak Budi."),
  st("s220", "h2", "ph", 2530, "Saudara saksi, siapa saja yang memegang kunci Gudang B?"),
  st("s221", "h2", "rina", 2550, "Setahu saya Pak Budi yang biasanya pegang kunci Gudang B."),
  st("s222", "h2", "ph", 2645, "Apakah Saudara melihat Pak Budi di gudang malam itu?"),
  st("s223", "h2", "rina", 2655, "Tidak, Pak. Saya tidak melihat Pak Budi malam itu."),
  st("s224", "h2", "ph", 2700, "Tadi Saudara bilang biasanya orangnya Pak Budi. Malam itu Saudara melihat orangnya?"),
  st("s225", "h2", "rina", 2712, "Tidak lihat, Pak. Itu cuma kebiasaan saja."),
  st("s226", "h2", "ha", 3060, "Saudara tadi bilang mampir dulu. Mampir ke mana?"),
  st("s227", "h2", "rina", 3080, "Ke warung depan, beli kopi, Yang Mulia. Tapi saya sudah tap kartu dulu di gerbang."),
  st("s228", "h2", "hk", 3930, "Baik. Saudara saksi, terima kasih. Sidang ditunda sampai Rabu, 4 November 2026, dengan acara pemeriksaan saksi berikutnya."),
  st("s229", "h2", "hk", 4350, "Sidang ditutup."),

  // Hearing 3 · live; the opening minutes are already transcribed
  st("s301", "h3", "hk", 35, "Sidang dilanjutkan dengan pemeriksaan saksi. Saudara Penuntut Umum, siapa saksi berikutnya?"),
  st("s302", "h3", "pu", 48, "Kami hadirkan saksi Dimas Prasetyo, Yang Mulia."),
  st("s303", "h3", "hk", 150, "Saudara saksi, keterangan yang Saudara berikan di persidangan inilah yang menjadi alat bukti, sebagaimana Pasal 185 KUHAP. Terangkan apa adanya.", { legal: ["lg1"] }),
  st("s304", "h3", "pu", 420, "Saudara bekerja sebagai apa di PT Sinar Logistik Contoh?"),
  st("s305", "h3", "dimas", 431, "Saya supervisor Gudang B sejak tahun 2022."),
];

/** Testimony the mock live session streams into hearing 3, one statement at a time. */
export const findings: Finding[] = [
  {
    id: "f1",
    hearingId: "h2",
    statementId: "s208",
    status: "potential_inconsistency",
    title: {
      id: "Jam kedatangan saksi berbeda dengan BAP dan log akses.",
      en: "The witness's arrival time differs from her BAP and the access log.",
    },
    explanation: {
      id: "Di persidangan saksi menyebut tiba jam setengah sepuluh malam. BAP halaman 4 mencatat sedikit setelah pukul 20.00 WIB, dan log akses mencatat kartunya masuk pukul 20:07:41.",
      en: "In court she said she arrived at half past nine. Her BAP (page 4) records shortly after 20:00, and the access log records her card entering at 20:07:41.",
    },
    uncertainty: {
      id: "Pada 00:51:20 saksi mengatakan sudah tap kartu sebelum mampir ke warung. Jam setengah sepuluh mungkin merujuk pada saat ia mulai berjaga, bukan saat tiba di gerbang.",
      en: "At 00:51:20 she says she tapped her card before stopping at a stall. 'Half past nine' may refer to when she started her post, not when she reached the gate.",
    },
    verify: {
      id: "Periksa apakah kedua keterangan merujuk pada peristiwa yang sama: tiba di gerbang atau mulai berjaga.",
      en: "Check whether both statements refer to the same event: reaching the gate or starting the shift.",
    },
    question:
      "Saudara menyebut tiba jam setengah sepuluh. Apakah itu saat Saudara tap kartu di gerbang, atau saat mulai berjaga setelah dari warung?",
    said: "jam setengah sepuluh malam",
    sources: [
      { passageId: "d1p4", relation: "conflicts", match: "sedikit setelah pukul 20.00 WIB" },
      { passageId: "d3p2", relation: "conflicts", match: "pukul 20:07:41" },
    ],
    legal: ["lg1"],
    reviewed: false,
    note: "",
  },
  {
    id: "f2",
    hearingId: "h2",
    statementId: "s216",
    status: "supported",
    title: {
      id: "Truk boks putih keluar menjelang tengah malam, sesuai log gerbang.",
      en: "A white box truck left near midnight, matching the gate log.",
    },
    explanation: {
      id: "Keterangan sesuai dengan BAP halaman 4 (sekitar 23.45 WIB) dan log akses yang mencatat kendaraan B 9123 XY keluar pukul 23:48:12.",
      en: "Matches her BAP, page 4 (around 23:45) and the access log recording vehicle B 9123 XY leaving at 23:48:12.",
    },
    verify: {
      id: "Bandingkan dengan jam dalam surat dakwaan (sekitar pukul 22.00 WIB).",
      en: "Compare with the time in the indictment (around 22:00).",
    },
    question:
      "Dari tempat Saudara berjaga, berapa jauh jarak ke Gerbang Timur, dan apakah Saudara melihat truk itu masuk sebelumnya?",
    said: "truk boks putih keluar lewat gerbang timur, menjelang tengah malam",
    sources: [
      { passageId: "d1p5", relation: "supports", match: "truk boks warna putih keluar melalui Gerbang Timur" },
      { passageId: "d3p3", relation: "supports", match: "pukul 23:48:12" },
    ],
    reviewed: true,
    note: "Dakwaan menyebut sekitar 22.00, truk keluar 23.48. Tanyakan dasar jam 22.00 kepada Penuntut Umum.",
  },
  {
    id: "f3",
    hearingId: "h2",
    statementId: "s221",
    status: "context_needed",
    title: {
      id: "Saksi hanya menyebut Terdakwa sebagai pemegang kunci; BAP lain menyebut dua orang.",
      en: "She names only the defendant as key holder; another BAP names two people.",
    },
    explanation: {
      id: "BAP Saksi Dimas halaman 2 menyebut kunci Gudang B dipegang oleh Dimas dan Terdakwa. Keterangan saksi tidak bertentangan, tetapi tidak menyebut pemegang kunci lainnya.",
      en: "Dimas's BAP (page 2) says the keys were held by Dimas and the defendant. Her testimony does not contradict this but leaves out the other key holder.",
    },
    verify: {
      id: "Pastikan apa dasar pengetahuan saksi tentang pemegang kunci.",
      en: "Establish how the witness knows who held the keys.",
    },
    question:
      "Dari mana Saudara tahu siapa yang memegang kunci Gudang B? Apakah Saudara pernah melihat orang lain memegangnya?",
    said: "Pak Budi yang biasanya pegang kunci Gudang B",
    sources: [{ passageId: "d2p2", relation: "context", match: "oleh saya selaku supervisor dan Sdr. Budi Santoso" }],
    reviewed: false,
    note: "",
  },
  {
    id: "f4",
    hearingId: "h2",
    statementId: "s219",
    status: "insufficient_evidence",
    title: {
      id: "Tidak ada sumber yang menunjukkan siapa yang biasanya mengemudikan truk.",
      en: "No source shows who usually drove the truck.",
    },
    explanation: {
      id: "Saksi menyebut biasanya orangnya Pak Budi. BAP saksi dan log akses tidak menyebut pengemudi, dan rekaman kamera 4 tidak menampilkan wajah pengemudi.",
      en: "She says it is usually Pak Budi's people. Neither her BAP nor the access log names a driver, and camera 4 does not show the driver's face.",
    },
    verify: {
      id: "Pisahkan kebiasaan yang diceritakan saksi dari apa yang ia lihat sendiri malam itu (lihat 00:45:12).",
      en: "Separate what the witness describes as habit from what she saw that night (see 00:45:12).",
    },
    question: "Pada malam 14 Maret, apakah Saudara melihat sendiri siapa yang berada di dalam truk itu?",
    said: "biasanya yang bawa truk itu orangnya Pak Budi",
    sources: [
      { passageId: "d3p3", relation: "context", match: "tidak menampilkan wajah pengemudi" },
      { passageId: "d1p5", relation: "context", match: "Saya tidak melihat jelas siapa pengemudinya" },
    ],
    reviewed: false,
    note: "",
  },
  {
    id: "f5",
    hearingId: "h2",
    statementId: "s212",
    status: "potential_inconsistency",
    title: {
      id: "Frekuensi patroli berbeda dengan BAP dan catatan patroli.",
      en: "Patrol frequency differs from her BAP and the patrol log.",
    },
    explanation: {
      id: "Saksi menyebut patroli setiap satu jam. BAP halaman 5 menyebut kurang lebih setiap dua jam, dan catatan patroli malam itu menunjukkan pukul 20.35, 22.40, 00.50 dan 02.55.",
      en: "She said she patrolled every hour. Her BAP (page 5) says roughly every two hours, and that night's patrol log shows 20:35, 22:40, 00:50 and 02:55.",
    },
    uncertainty: {
      id: "Saksi mungkin menggambarkan aturan jaga, bukan apa yang ia lakukan malam itu.",
      en: "She may be describing the patrol rule rather than what she did that night.",
    },
    verify: {
      id: "Tanyakan apakah setiap satu jam adalah aturan jaga atau yang benar-benar dilakukan pada 14 Maret.",
      en: "Ask whether 'every hour' is the rule or what she actually did on 14 March.",
    },
    question:
      "Apakah patroli setiap satu jam itu aturan jaga, atau yang Saudara lakukan malam 14 Maret? Catatan patroli menunjukkan jeda sekitar dua jam.",
    said: "setiap satu jam sekali",
    sources: [
      { passageId: "d1p6", relation: "conflicts", match: "kurang lebih setiap dua jam" },
      { passageId: "d3p4", relation: "conflicts", match: "20.35, 22.40, 00.50 dan 02.55 WIB" },
    ],
    reviewed: false,
    note: "",
  },
  {
    id: "f6",
    hearingId: "h2",
    statementId: "s214",
    status: "supported",
    title: {
      id: "Saksi menggantikan Sdr. Yusuf, sesuai BAP.",
      en: "She took over from Yusuf, as in her BAP.",
    },
    explanation: {
      id: "Sesuai BAP halaman 4: saksi datang untuk menggantikan rekan jaga sore, Sdr. Yusuf.",
      en: "Matches her BAP, page 4: she came to relieve the afternoon guard, Yusuf.",
    },
    verify: {
      id: "Sdr. Yusuf belum diperiksa. Pertimbangkan apakah keterangannya diperlukan.",
      en: "Yusuf has not testified. Consider whether his account is needed.",
    },
    question: "Jam berapa tepatnya Sdr. Yusuf meninggalkan pos setelah Saudara datang?",
    said: "Pak Yusuf, satpam shift sore",
    sources: [{ passageId: "d1p4", relation: "supports", match: "menggantikan rekan saya, Sdr. Yusuf" }],
    reviewed: true,
    note: "",
  },
  {
    id: "f7",
    hearingId: "h2",
    statementId: "s223",
    status: "supported",
    title: {
      id: "Saksi tidak melihat Terdakwa malam itu; kartu Terdakwa tidak tercatat.",
      en: "She did not see the defendant that night; his card was not recorded.",
    },
    explanation: {
      id: "Keterangan saksi sejalan dengan log akses halaman 11: kartu atas nama B. Santoso tidak tercatat digunakan pada 14/03/2026. Ketiadaan catatan tidak membuktikan ketidakhadiran.",
      en: "Consistent with the access log, page 11: the card in B. Santoso's name was not used on 14/03/2026. The absence of a record does not prove absence.",
    },
    verify: {
      id: "Periksa apakah ada pintu masuk lain tanpa kartu akses.",
      en: "Check whether there are entrances without card readers.",
    },
    question: "Selain Gerbang Timur, apakah ada jalan masuk ke Gudang B yang tidak memakai kartu akses?",
    said: "Saya tidak melihat Pak Budi malam itu",
    sources: [{ passageId: "d3p5", relation: "supports", match: "tidak tercatat digunakan" }],
    reviewed: false,
    note: "",
  },
];

export const documents: CaseDocument[] = [
  { id: "d1", caseId: "c1", title: "BAP Saksi Rina Hartati", kind: { id: "Berita acara pemeriksaan", en: "Witness examination record (BAP)" }, pages: 6, file: "PDF", size: "412 KB", added: "2026-10-10" , pdf: "/demo/documents/d1.pdf" },
  { id: "d2", caseId: "c1", title: "BAP Saksi Dimas Prasetyo", kind: { id: "Berita acara pemeriksaan", en: "Witness examination record (BAP)" }, pages: 5, file: "PDF", size: "388 KB", added: "2026-10-10" , pdf: "/demo/documents/d2.pdf" },
  { id: "d3", caseId: "c1", title: "Laporan Log Akses Gerbang & CCTV", kind: { id: "Laporan digital forensik", en: "Digital forensics report" }, pages: 12, file: "PDF", size: "2.1 MB", added: "2026-10-12" , pdf: "/demo/documents/d3.pdf" },
  { id: "d4", caseId: "c1", title: "Surat Dakwaan PDM-112/2026", kind: { id: "Surat dakwaan", en: "Indictment" }, pages: 9, file: "DOCX", size: "96 KB", added: "2026-10-06" , pdf: "/demo/documents/d4.pdf" },
  { id: "d5", caseId: "c1", title: "Berita Acara Stock Opname Gudang B", kind: { id: "Berita acara", en: "Official record" }, pages: 4, file: "PDF", size: "640 KB", added: "2026-10-12" , pdf: "/demo/documents/d5.pdf" },
  { id: "d6", caseId: "c2", title: "Laporan Polisi LP/B/0451/2026", kind: { id: "Laporan polisi", en: "Police report" }, pages: 3, file: "PDF", size: "210 KB", added: "2026-10-28" , pdf: "/demo/documents/d6.pdf" },
  { id: "d7", caseId: "c2", title: "Tangkapan Layar Grup Arisan", kind: { id: "Bukti elektronik", en: "Electronic evidence" }, pages: 14, file: "PDF", size: "5.4 MB", added: "2026-10-29" , pdf: "/demo/documents/d7.pdf", scanned: true },
];

export const passages: Passage[] = [
  { id: "d1p1", docId: "d1", page: 1, text: "Pada hari ini, Senin tanggal 16 Maret 2026 pukul 10.00 WIB, saya penyidik pada Kepolisian Sektor Contoh telah memeriksa seorang perempuan yang mengaku bernama Rina Hartati sebagai saksi." },
  { id: "d1p2", docId: "d1", page: 2, text: "Saya bekerja sebagai petugas keamanan (satpam) di Gudang B PT Sinar Logistik Contoh sejak Januari 2024, dengan jadwal jaga malam pukul 20.00 sampai 08.00 WIB." },
  { id: "d1p3", docId: "d1", page: 3, text: "Area bongkar muat Gudang B dilengkapi empat kamera pengawas. Lampu sorot di sisi timur sering padam sejak awal Maret 2026." },
  { id: "d1p4", docId: "d1", page: 4, text: "Pada hari Sabtu tanggal 14 Maret 2026 saya tiba di gudang sedikit setelah pukul 20.00 WIB untuk menggantikan rekan saya, Sdr. Yusuf, yang berjaga sore." },
  { id: "d1p5", docId: "d1", page: 4, text: "Sekitar pukul 23.45 WIB saya melihat truk boks warna putih keluar melalui Gerbang Timur. Saya tidak melihat jelas siapa pengemudinya karena lampu di area bongkar muat mati." },
  { id: "d1p6", docId: "d1", page: 5, text: "Patroli keliling saya lakukan kurang lebih setiap dua jam dan saya catat pada buku patroli." },
  { id: "d1p7", docId: "d1", page: 6, text: "Demikian berita acara ini dibuat dengan sebenarnya, kemudian dibacakan kembali dan saksi menyatakan setuju lalu membubuhkan tanda tangan." },
  { id: "d2p1", docId: "d2", page: 1, text: "Saya bekerja sebagai supervisor Gudang B PT Sinar Logistik Contoh sejak Agustus 2022." },
  { id: "d2p2", docId: "d2", page: 2, text: "Kunci Gudang B hanya dipegang oleh saya selaku supervisor dan Sdr. Budi Santoso selaku koordinator logistik." },
  { id: "d2p3", docId: "d2", page: 3, text: "Pada tanggal 14 Maret 2026 saya pulang dari gudang pukul 18.30 WIB setelah memastikan pintu Gudang B terkunci." },
  { id: "d2p4", docId: "d2", page: 4, text: "Stock opname terakhir sebelum kejadian dilaksanakan pada 28 Februari 2026 dan tidak ditemukan selisih." },
  { id: "d2p5", docId: "d2", page: 5, text: "Saya mengetahui adanya selisih barang setelah melakukan penghitungan ulang pada 16 Maret 2026." },
  { id: "d3p1", docId: "d3", page: 1, text: "Laporan ini memuat ekstraksi data kartu akses dan rekaman kamera Gerbang Timur Gudang B periode 14–15 Maret 2026." },
  { id: "d3p2", docId: "d3", page: 7, text: "Kartu akses atas nama R. Hartati tercatat masuk di Gerbang Timur pada 14/03/2026 pukul 20:07:41." },
  { id: "d3p3", docId: "d3", page: 8, text: "Kendaraan boks putih nomor polisi B 9123 XY tercatat keluar melalui Gerbang Timur pukul 23:48:12. Rekaman kamera 4 tidak menampilkan wajah pengemudi." },
  { id: "d3p4", docId: "d3", page: 10, text: "Catatan patroli petugas jaga pada 14–15 Maret 2026: 20.35, 22.40, 00.50 dan 02.55 WIB." },
  { id: "d3p5", docId: "d3", page: 11, text: "Kartu akses atas nama B. Santoso tidak tercatat digunakan pada 14/03/2026." },
  { id: "d3p6", docId: "d3", page: 12, text: "Kartu akses atas nama D. Prasetyo tercatat keluar di Gerbang Timur pada 14/03/2026 pukul 18:41:05." },
  { id: "d4p1", docId: "d4", page: 1, text: "PRIMAIR: Bahwa Terdakwa Budi Santoso selaku koordinator logistik pada PT Sinar Logistik Contoh, yang barang-barang dalam gudang berada dalam penguasaannya karena hubungan kerja," },
  { id: "d4p2", docId: "d4", page: 2, text: "pada hari Sabtu tanggal 14 Maret 2026 sekitar pukul 22.00 WIB, atau setidak-tidaknya pada waktu lain dalam bulan Maret 2026, bertempat di Gudang B PT Sinar Logistik Contoh," },
  { id: "d4p3", docId: "d4", page: 3, text: "yang mengakibatkan hilangnya 120 (seratus dua puluh) karton barang elektronik milik PT Sinar Logistik Contoh." },
  { id: "d4p4", docId: "d4", page: 8, text: "Perbuatan Terdakwa sebagaimana diatur dan diancam pidana dalam Pasal 374 KUHP." },
  { id: "d5p1", docId: "d5", page: 1, text: "Stock opname Gudang B dilaksanakan pada tanggal 28 Februari 2026 sampai dengan 1 Maret 2026." },
  { id: "d5p2", docId: "d5", page: 2, text: "Penghitungan disaksikan oleh supervisor gudang dan perwakilan bagian keuangan." },
  { id: "d5p3", docId: "d5", page: 3, text: "Hasil penghitungan ulang tanggal 16 Maret 2026: selisih 120 karton (televisi 43 inci dan perangkat audio)." },
  { id: "d6p1", docId: "d6", page: 1, text: "Pelapor menyetorkan dana arisan sebesar Rp45.000.000 secara bertahap sejak Juni 2025." },
  { id: "d7p1", docId: "d7", page: 6, text: "Pesan dari akun admin grup tertanggal 2 Februari 2026: Pencairan diundur sampai bulan depan." },
];

const why = (id: string, en: string) => ({ id, en });

export const connections: Connection[] = [
  { id: "cn1", from: { kind: "statement", id: "s208" }, to: { kind: "passage", id: "d1p4" }, relation: "conflicts", reviewed: false, basis: "ai", why: why("Jam kedatangan berbeda: setengah sepuluh vs sedikit setelah pukul 20.00.", "Arrival times differ: half past nine vs shortly after 20:00.") },
  { id: "cn2", from: { kind: "statement", id: "s208" }, to: { kind: "passage", id: "d3p2" }, relation: "conflicts", reviewed: false, basis: "ai", why: why("Log kartu masuk pukul 20:07:41.", "Card entry logged at 20:07:41.") },
  { id: "cn3", from: { kind: "passage", id: "d1p4" }, to: { kind: "passage", id: "d3p2" }, relation: "supports", reviewed: true, basis: "ai", why: why("BAP dan log akses sama-sama menunjukkan sekitar pukul 20.00.", "The BAP and the access log both point to around 20:00.") },
  { id: "cn4", from: { kind: "statement", id: "s216" }, to: { kind: "passage", id: "d3p3" }, relation: "supports", reviewed: true, basis: "ai", why: why("Truk keluar menjelang tengah malam; log 23:48:12.", "Truck left near midnight; logged at 23:48:12.") },
  { id: "cn5", from: { kind: "statement", id: "s216" }, to: { kind: "passage", id: "d1p5" }, relation: "supports", reviewed: true, basis: "keywords", why: why("Truk boks putih di Gerbang Timur.", "White box truck at the East Gate.") },
  { id: "cn6", from: { kind: "statement", id: "s221" }, to: { kind: "passage", id: "d2p2" }, relation: "context", reviewed: false, basis: "ai", why: why("Pemegang kunci: saksi hanya menyebut Terdakwa.", "Key holders: she names only the defendant.") },
  { id: "cn7", from: { kind: "statement", id: "s212" }, to: { kind: "passage", id: "d3p4" }, relation: "conflicts", reviewed: false, basis: "ai", why: why("Catatan patroli berjarak sekitar dua jam.", "Patrol entries are about two hours apart.") },
  { id: "cn8", from: { kind: "statement", id: "s212" }, to: { kind: "passage", id: "d1p6" }, relation: "conflicts", reviewed: false, basis: "semantic", why: why("Frekuensi patroli.", "Patrol frequency.") },
  { id: "cn9", from: { kind: "statement", id: "s223" }, to: { kind: "passage", id: "d3p5" }, relation: "supports", reviewed: false, basis: "ai", why: why("Kartu Terdakwa tidak tercatat malam itu.", "The defendant's card was not recorded that night.") },
  { id: "cn10", from: { kind: "passage", id: "d4p2" }, to: { kind: "passage", id: "d3p3" }, relation: "context", reviewed: false, basis: "ai", why: why("Dakwaan menyebut sekitar 22.00; truk keluar 23:48.", "The indictment says around 22:00; the truck left at 23:48.") },
  { id: "cn11", from: { kind: "passage", id: "d5p1" }, to: { kind: "passage", id: "d2p4" }, relation: "context", reviewed: true, basis: "keywords", why: why("Tanggal stock opname: 28 Feb–1 Mar vs 28 Feb.", "Stock-count dates: 28 Feb–1 Mar vs 28 Feb.") },
  { id: "cn12", from: { kind: "passage", id: "d4p3" }, to: { kind: "passage", id: "d5p3" }, relation: "related", reviewed: true, basis: "keywords", why: why("Jumlah 120 karton.", "The 120-carton figure.") },
  { id: "cn13", from: { kind: "statement", id: "s214" }, to: { kind: "passage", id: "d1p4" }, relation: "supports", reviewed: true, basis: "ai", why: why("Menggantikan Sdr. Yusuf.", "Relieving Yusuf.") },
  { id: "cn14", from: { kind: "statement", id: "s219" }, to: { kind: "passage", id: "d3p3" }, relation: "context", reviewed: false, basis: "ai", why: why("Kamera tidak menampilkan wajah pengemudi.", "The camera does not show the driver's face.") },
  { id: "cn15", from: { kind: "passage", id: "d2p3" }, to: { kind: "passage", id: "d3p6" }, relation: "supports", reviewed: true, basis: "ai", why: why("BAP 18.30 dan kartu keluar 18:41.", "BAP 18:30 and card exit at 18:41.") },
];

export const legal: LegalRef[] = [
  {
    id: "lg1",
    type: "UU",
    regulation: "UU No. 8 Tahun 1981 tentang Hukum Acara Pidana (KUHAP)",
    article: "Pasal 185",
    summary: {
      id: "Keterangan saksi sebagai alat bukti ialah apa yang saksi nyatakan di sidang pengadilan. Keterangan satu saksi saja tidak cukup untuk membuktikan kesalahan terdakwa.",
      en: "Witness testimony as evidence is what the witness states in court. One witness alone is not enough to prove the defendant guilty.",
    },
    keywords: ["saksi", "keterangan", "alat bukti", "testimony", "witness", "185", "kuhap"],
  },
  {
    id: "lg2",
    type: "UU",
    regulation: "UU No. 8 Tahun 1981 tentang Hukum Acara Pidana (KUHAP)",
    article: "Pasal 184",
    summary: {
      id: "Alat bukti yang sah: keterangan saksi, keterangan ahli, surat, petunjuk, dan keterangan terdakwa.",
      en: "Lawful evidence: witness testimony, expert testimony, documents, indications and the defendant's statement.",
    },
    keywords: ["alat bukti", "bukti", "evidence", "184", "kuhap", "surat"],
  },
  {
    id: "lg3",
    type: "KUHP",
    regulation: "Kitab Undang-Undang Hukum Pidana (KUHP)",
    article: "Pasal 374",
    summary: {
      id: "Penggelapan oleh orang yang menguasai barang karena hubungan kerja, pencarian, atau upah; ancaman pidana penjara paling lama lima tahun.",
      en: "Embezzlement by a person holding goods through employment, occupation or pay; up to five years' imprisonment.",
    },
    keywords: ["penggelapan", "jabatan", "hubungan kerja", "embezzlement", "374", "kuhp"],
  },
  {
    id: "lg4",
    type: "KUHP",
    regulation: "Kitab Undang-Undang Hukum Pidana (KUHP)",
    article: "Pasal 372",
    summary: {
      id: "Penggelapan: dengan sengaja dan melawan hukum memiliki barang milik orang lain yang ada dalam kekuasaannya bukan karena kejahatan.",
      en: "Embezzlement: intentionally and unlawfully appropriating another person's goods held other than through a crime.",
    },
    keywords: ["penggelapan", "embezzlement", "372", "kuhp", "barang"],
  },
  {
    id: "lg5",
    type: "UU",
    regulation: "UU No. 8 Tahun 1981 tentang Hukum Acara Pidana (KUHAP)",
    article: "Pasal 173",
    summary: {
      id: "Hakim ketua sidang dapat mendengar keterangan saksi tanpa hadirnya terdakwa; pemeriksaan tidak boleh diteruskan sebelum terdakwa diberitahu.",
      en: "The presiding judge may hear a witness without the defendant present; the hearing may not continue until the defendant is informed.",
    },
    keywords: ["saksi", "terdakwa", "tanpa hadirnya", "173", "kuhap"],
  },
  {
    id: "lg6",
    type: "PERMA",
    regulation: "PERMA No. 5 Tahun 2020 tentang Protokol Persidangan dan Keamanan dalam Lingkungan Pengadilan",
    article: "",
    summary: {
      id: "Pengambilan foto, rekaman audio, atau rekaman audio visual di ruang sidang memerlukan izin hakim atau ketua majelis sebelum persidangan dimulai.",
      en: "Photos, audio or video recordings in the courtroom need the permission of the judge or presiding judge before the hearing begins.",
    },
    keywords: ["rekam", "rekaman", "audio", "perma", "recording", "izin", "permission"],
  },
];

