import type { CaseSummary, Workspace } from '@jude/core/domain';
import { needsReview } from '@jude/core/domain';

type Copy = [id: string, en: string];

export interface TourStep {
  id: string;
  href: string;
  target: string;
  title: Copy;
  body: Copy;
}

export interface Guide {
  id: string;
  name: Copy;
  description: Copy;
  image: string;
  steps: TourStep[];
}

const hook = (word: string) => '[data-tour~="' + word + '"]';
const part = encodeURIComponent;
function step(id: string, href: string, target: string, title: Copy, body: Copy): TourStep {
  return { id, href, target, title, body };
}
function guide(
  id: string,
  name: Copy,
  description: Copy,
  image: string,
  steps: (TourStep | undefined | '')[]
): Guide {
  return { id, name, description, image, steps: steps.filter((s): s is TourStep => !!s) };
}

export function makeGuides(w?: Workspace, cases: CaseSummary[] = []): Guide[] {
  if (!w)
    return [
      guide(
        'register',
        ['Daftar perkara', 'The case register'],
        ['Cari berkas atau buka perkara pertama.', 'Find a file or open your first case.'],
        'folder',
        [
          step(
            'register',
            '/cases',
            hook('case-register'),
            ['Berkas di ruang kerja Anda', 'Your case files'],
            cases.length
              ? [
                  'Pilih satu perkara untuk membuka ikhtisar, sidang, dokumen, dan temuannya.',
                  'Open a file to see its hearings, exhibits, and findings. Each file has its own feature tours.',
                ]
              : [
                  'Daftar ini akan berisi perkara yang dapat Anda akses. Setiap perkara memiliki berkas bukti sendiri.',
                  'As you add cases, the files you can access appear here. Each case has its own evidence record.',
                ]
          ),
          step(
            'create',
            '/cases',
            hook('case-new'),
            ['Buka perkara', 'Start a case'],
            [
              'Gunakan Perkara baru untuk memberi nama berkas dan menambahkan nomor perkara. Anda dapat menambahkan bukti nanti.',
              'Choose New case to name the file and enter its reference. You can add evidence later.',
            ]
          ),
          step(
            'search',
            '/cases',
            hook('case-search'),
            ['Temukan berkas', 'Find a file'],
            [
              'Ketik bagian judul atau nomor perkara untuk menyaring daftar. Hapus kata pencarian untuk menampilkan semua berkas.',
              'Type part of a title or case reference to narrow the register. Clear the search to see all files.',
            ]
          ),
        ]
      ),
    ];

  const base = '/case/' + part(w.caseRecord.id);
  const hearings = base + '/hearings',
    documents = base + '/documents',
    findings = base + '/findings';
  const map = base + '/connections',
    assistant = base + '/assistant',
    board = findings + '?view=board';
  const live = w.hearings.find((h) => h.mode === 'live');
  const recorded = w.hearings.find(
    (h) => h.mode === 'recorded' && (h.audio || w.caseRecord.label === 'synthetic')
  );
  const hearing = live ?? recorded ?? w.hearings.find((h) => h.mode !== 'scheduled');
  const hearingPath = (id: string) => hearings + '/' + part(id);
  const finding =
    w.findings.find((f) => needsReview(f) && f.sources.length) ??
    w.findings.find((f) => f.sources.length) ??
    w.findings[0];
  const findPath = finding && findings + '/' + part(finding.id);
  const passage = w.passages.find((p) => p.id === finding?.sources[0]?.passageId) ?? w.passages[0];
  const doc = w.documents.find((d) => d.id === passage?.docId) ?? w.documents[0];
  const reader =
    doc && documents + '/' + part(doc.id) + (passage ? '?p=' + part(passage.id) + '&view=text' : '');
  const edge = w.connections[0];
  const focus =
    finding && finding.sources.length ? 'finding:' + finding.id : edge && edge.from.kind + ':' + edge.from.id;
  const thread = w.threads.find((t) => t.messages.some((m) => m.citations?.length));
  const threadPath = thread && assistant + '/' + part(thread.id);
  const canEdit = !w.caseRecord.archived;
  const compare =
    findPath &&
    step(
      'compare',
      findPath,
      hook('finding-comparison') + ',' + hook('finding-question'),
      ['Bandingkan kata persisnya', 'Compare the exact words'],
      [
        'Baca ucapan di sidang dan kutipan dokumen. Kata yang ditandai menunjukkan letak perbandingannya.',
        'Read the testimony beside the quoted record. The marked words show exactly what is being compared.',
      ]
    );
  const decide =
    findPath &&
    step(
      'decide',
      findPath,
      hook('finding-review'),
      ['Catat hasil pemeriksaan', 'Record your review'],
      [
        'Tandai temuan setelah memeriksa bukti atau simpan temuan ke papan. Status pemeriksaan dapat dibuka kembali.',
        'After checking the evidence, mark the finding checked or put it on a board. You can reopen the review later.',
      ]
    );
  const source =
    reader &&
    step(
      'source',
      reader,
      passage ? hook('source-passage') : hook('doc-view-switch'),
      ['Baca sumber asli', 'Read the source in context'],
      passage
        ? [
            'Lihat kutipan terpilih bersama teks di sekitarnya. Catat halaman sebelum kembali ke temuan.',
            'Read the cited passage with the surrounding text. Its page number lets you return to the original.',
          ]
        : [
            'Pilih tampilan asli atau teks yang tersedia untuk dokumen ini.',
            'Switch between the original and the text available for this exhibit.',
          ]
    );
  const intake = canEdit
    ? step(
        'new-hearing',
        hearings,
        hook('hearings-new'),
        ['Siapkan sidang', 'Set up a hearing'],
        [
          'Sidang baru membuka pilihan untuk menjadwalkan sidang, mengimpor risalah, atau mulai merekam dengan izin.',
          'New hearing lets you schedule a session, import minutes, or start recording with permission.',
        ]
      )
    : undefined;
  const upload = canEdit
    ? step(
        'upload',
        documents,
        hook('doc-upload'),
        ['Masukkan bukti', 'Add an exhibit'],
        [
          'Unggah satu berkas perkara. Dokumen kemudian dapat dibaca menurut halaman serta ditautkan ke pernyataan.',
          'Upload a case document. Its pages can then be read and linked to testimony.',
        ]
      )
    : undefined;
  const mapStep = step(
    'map',
    map,
    hook('connections-map'),
    ['Ikuti hubungan bukti', 'Trace evidence links'],
    [
      'Peta menempatkan ucapan, temuan, dan kutipan berkas dalam kolom. Pilih satu butir untuk memusatkan kelompoknya.',
      'The columns hold statements, findings, and passages. Select an item to bring its group of related evidence into view.',
    ]
  );
  const compose = step(
    'composer',
    assistant + '/new',
    hook('assistant-composer'),
    ['Tentukan dasar pertanyaan', 'Give your question a source'],
    [
      'Tambahkan rujukan dari perkara lalu tulis pertanyaan. Periksa kutipan pada jawaban sebelum menggunakannya.',
      'Attach a case reference and write your question. Open the cited passage or statement before relying on the answer.',
    ]
  );
  return [
    guide(
      'overview',
      ['Mengenal perkara', 'Explore a case'],
      ['Ikuti ucapan hingga ke berkas sumbernya.', 'Follow testimony back to the case file.'],
      'folder',
      [
        step(
          'file',
          base,
          hook('case-file'),
          ['Di dalam berkas perkara', 'Inside the case file'],
          [
            'Judul dan nomor perkara menandai berkas yang sedang Anda baca. Sidang, temuan, dan dokumen di sini berada dalam perkara ini.',
            'The title and reference identify the file you are reading. Its hearings, findings, and documents stay with this case.',
          ]
        ),
        hearing
          ? step(
              'hearing',
              hearingPath(hearing.id),
              hook('transcript'),
              ['Dari ruang sidang', 'Start with testimony'],
              [
                'Nama dan waktu mengidentifikasi siapa yang berbicara. Tautan temuan di bawah ucapan membuka perbandingan buktinya.',
                'The name and timestamp identify each speaker. A finding under a statement opens its evidence comparison.',
              ]
            )
          : intake,
        compare,
        decide,
        source ?? upload,
        compose,
        step(
          'sections',
          base,
          hook('sections'),
          ['Pindah bagian perkara', 'Move between sections'],
          [
            'Gunakan navigasi perkara untuk kembali ke sidang, dokumen, temuan atau keterkaitan. Panduan lain tersedia di menu ruang kerja.',
            'Use case navigation to return to hearings, documents, findings, or connections. Reopen Guided tours in the workspace menu for another feature.',
          ]
        ),
      ]
    ),
    guide(
      'hearing',
      ['Mengikuti sidang', 'Follow a hearing'],
      [
        'Dari daftar sidang ke ucapan dan penanda waktunya.',
        'Read the hearing register, testimony, and timeline.',
      ],
      'speech',
      [
        intake,
        step(
          'register',
          hearings,
          hook('hearings-list'),
          ['Baca daftar sidang', 'Read the hearing register'],
          [
            'Tanggal, status, dan judul membedakan sidang terjadwal dari sidang yang sudah memiliki risalah.',
            'Dates, statuses, and titles distinguish a scheduled session from one with testimony on file.',
          ]
        ),
        live &&
          step(
            'controls',
            hearingPath(live.id),
            hook('live-controls'),
            ['Kontrol sidang langsung', 'Live hearing controls'],
            [
              'Periksa status dan waktu berjalan di sini. Jeda menghentikan aliran baru selama Anda membaca.',
              'Check the live status and elapsed time here. Pause to hold new testimony while you read.',
            ]
          ),
        live && w.findings.some((f) => f.hearingId === live.id && needsReview(f))
          ? step(
              'attention',
              hearingPath(live.id),
              hook('live-attention'),
              ['Temuan dari ucapan terbaru', 'A finding from testimony'],
              [
                'Buka temuan untuk melihat apa yang dikatakan, sumber pembanding, dan pertanyaan yang dapat diajukan.',
                'Open the finding to read what was said, see its source, and consider a follow-up question.',
              ]
            )
          : undefined,
        hearing &&
          step(
            'transcript',
            hearingPath(hearing.id),
            hook('transcript'),
            ['Telusuri ucapan', 'Read the transcript'],
            [
              'Setiap ucapan mempunyai pembicara dan waktu. Simpan penanda pada kalimat yang akan Anda periksa lagi.',
              'Each statement has a speaker and time. Bookmark a line you need to revisit.',
            ]
          ),
        recorded &&
          step(
            'player',
            hearingPath(recorded.id),
            hook('review-timeline'),
            ['Siapa berbicara, kapan', 'Who spoke when'],
            [
              'Jalur berwarna menunjukkan giliran pembicara. Pilih waktu di linimasa atau gunakan tombol panah untuk maju dan mundur.',
              'Colored tracks show speaker turns. Pick a time on the timeline or move ten seconds with the arrow keys.',
            ]
          ),
      ]
    ),
    guide(
      'findings',
      ['Menelaah temuan', 'Review findings'],
      [
        'Periksa perbandingan, sumber, dan tindak lanjut.',
        'Compare statements and sources, then record your decision.',
      ],
      'finding',
      [
        step(
          'filters',
          findings,
          hook('findings-tabs'),
          ['Pilih antrean', 'Choose a review queue'],
          [
            'Pisahkan temuan yang perlu dicek, yang sudah diperiksa, dan ucapan yang Anda tandai.',
            'Switch between findings to check, completed reviews, other findings, and bookmarked testimony.',
          ]
        ),
        w.findings.length
          ? step(
              'queue',
              findings,
              hook('findings-queue'),
              ['Baca temuan dalam urutan sidang', 'Read findings in hearing order'],
              [
                'Waktu dan judul menghubungkan setiap temuan dengan satu pernyataan. Pilih judul untuk meninjau sumbernya.',
                'The timestamp connects each finding to a statement. Open its title to inspect the source.',
              ]
            )
          : undefined,
        compare,
        decide,
        step(
          'board',
          findings,
          hook('board-open'),
          ['Buka papan temuan', 'Open the findings board'],
          [
            'Beralih dari daftar ke papan untuk menyusun bukti yang ingin Anda kerjakan bersama.',
            'Switch from the list to the board to arrange evidence you want to examine together.',
          ]
        ),
      ]
    ),
    guide(
      'documents',
      ['Membaca dokumen', 'Read documents'],
      ['Temukan kutipan dan halaman aslinya.', 'Find an exhibit and return to its cited page.'],
      'page',
      [
        upload,
        step(
          'search',
          documents,
          hook('docs-search'),
          ['Cari berkas perkara', 'Search the exhibit register'],
          [
            'Cari dengan judul atau saring jenis dokumen untuk menemukan bukti yang tepat.',
            'Search by title or filter the document type to find an exhibit.',
          ]
        ),
        doc &&
          step(
            'list',
            documents,
            hook('docs-list'),
            ['Buka dokumen', 'Open an exhibit'],
            [
              'Judul membuka dokumen. Jumlah halaman membantu membedakan berkas yang namanya mirip.',
              'Open a document by its title. The page count helps distinguish similarly named exhibits.',
            ]
          ),
        source,
        reader &&
          step(
            'views',
            reader,
            hook('doc-view-switch'),
            ['Pilih cara membaca', 'Choose a reading view'],
            [
              'Tampilan asli mempertahankan tata letak halaman. Tampilan teks memudahkan membaca kutipan di layar kecil.',
              'The original retains the page layout. Text view reflows its passages on a smaller screen.',
            ]
          ),
      ]
    ),
    guide(
      'connections',
      ['Menelusuri keterkaitan', 'Explore connections'],
      ['Ikuti pasangan bukti dalam satu kelompok.', 'Follow a group of related evidence.'],
      'connect',
      [
        mapStep,
        w.connections.length
          ? step(
              'filters',
              map,
              hook('map-filters'),
              ['Saring hubungan', 'Filter relationships'],
              [
                'Gunakan jenis hubungan untuk menampilkan dukungan, perbedaan, atau konteks. Pilih kembali untuk mengembalikannya.',
                'Use the relationship filters to show support, conflict, or context. Toggle a filter again to restore it.',
              ]
            )
          : step(
              'find',
              map,
              hook('map-search'),
              ['Cari bukti', 'Find evidence'],
              [
                'Pencarian menampilkan ucapan dan kutipan yang dapat dipilih saat bukti ditambahkan.',
                'Search lists the case statements and passages you can select as evidence is added.',
              ]
            ),
        focus &&
          step(
            'group',
            map + '?of=' + encodeURIComponent(focus),
            hook('group-head'),
            ['Periksa kelompok pilihan', 'Inspect the selected group'],
            [
              'Panel ini menjelaskan bukti yang terhubung. Buka salah satu rujukan untuk membaca bagiannya di tempat asal.',
              'This panel identifies the connected material. Open a reference to read the evidence in its original context.',
            ]
          ),
      ]
    ),
    guide(
      'board',
      ['Menyusun papan', 'Arrange a board'],
      ['Kumpulkan kartu dan hubungkan gagasan pemeriksaan.', 'Collect evidence and link your working notes.'],
      'spool',
      [
        step(
          'view',
          findings,
          hook('board-open'),
          ['Masuk ke papan', 'Switch to the board'],
          [
            'Pilih Papan dari halaman Temuan. Papan menyimpan susunan kartu untuk perkara ini.',
            'Select Board on Findings. A board keeps a working arrangement of cards for this case.',
          ]
        ),
        step(
          'canvas',
          board,
          hook('board-canvas'),
          ['Ruang untuk menyusun bukti', 'Arrange your evidence'],
          [
            'Kartu menyimpan rujukan ke bukti asalnya. Tempatkan butir yang saling berkaitan berdekatan.',
            'Cards retain their original references. Arrange related pieces of evidence together.',
          ]
        ),
        step(
          'add',
          board,
          hook('board-add'),
          ['Tambahkan kartu bukti', 'Add an evidence card'],
          [
            'Pilih temuan, ucapan atau kutipan yang sudah ada untuk ditaruh di papan.',
            'Choose a finding, statement, or passage from the case to put on the board.',
          ]
        ),
      ]
    ),
    guide(
      'assistant',
      ['Bertanya kepada asisten', 'Ask the case assistant'],
      [
        'Susun pertanyaan, telusuri jawaban, dan baca rujukannya.',
        'Ask a grounded question and open its evidence.',
      ],
      'quote',
      [
        step(
          'suggestions',
          assistant + '/new',
          hook('assistant-suggestions'),
          ['Mulai dari pertanyaan perkara', 'Start a case question'],
          [
            'Pertanyaan awal membantu menelusuri bukti yang sudah ada. Anda juga dapat menulis pertanyaan sendiri.',
            'The starting questions help you explore material already in the file. You can also write your own.',
          ]
        ),
        compose,
        threadPath &&
          step(
            'answer',
            threadPath,
            hook('assistant-answer'),
            ['Periksa jawaban', 'Inspect an answer'],
            [
              'Baca jawabannya bersama batasan dan sumber yang disediakan.',
              'Read the answer together with its limitations and cited evidence.',
            ]
          ),
        threadPath &&
          step(
            'citations',
            threadPath,
            hook('assistant-citations'),
            ['Lacak sumber jawaban', 'Trace the cited sources'],
            [
              'Buka daftar rujukan untuk kembali ke ucapan atau halaman dokumen yang mendasari jawaban.',
              'Open the source list to return to the statement or exhibit page behind an answer.',
            ]
          ),
      ]
    ),
  ];
}
