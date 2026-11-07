<script lang="ts">
  import { ArrowLeft, ArrowRight, Maximize2, Minus, Plus, Search } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import MapColumnIndex from './MapColumnIndex.svelte';
  import type { Lang, Relation, Workspace } from '@jude/core/domain';
  import { clock as fmtClock, casePath } from '../records';
  import { statusRelation, type Pairing, type Kind as EvidenceKind } from '../graph';
  import { relationOrder as relations, mapRecords, type IconKind as Kind } from './map-records';
  import { PanZoom, type Bounds } from './map-camera.svelte';
  import KindIcon from './GraphIcon.svelte';
  let {
    workspace,
    lang,
    selected,
    pairings,
    members,
    picked,
    hidden = $bindable([]),
    onpick,
    onchoose
  }: {
    workspace: Workspace;
    lang: Lang;
    selected: string;
    pairings: Pairing[];
    members: Set<string>;
    picked: string[];
    hidden?: Relation[];
    onpick: () => void;
    onchoose: (key: string, keyboard?: boolean) => void;
  } = $props();
  let {
    t,
    l,
    statement,
    speaker,
    shortName,
    speakerName,
    whereOf,
    hearing,
    finding,
    passage,
    doc,
    statementsOf,
    passagesOf,
    findingPath
  } = $derived(mapRecords(workspace, lang));
  const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const motions = () => typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let motionOk = $state(false),
    touch = $state(false);
  $effect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'),
      pointer = matchMedia('(pointer: coarse)');
    const sync = () => {
      motionOk = motions();
      touch = coarse();
    };
    sync();
    media.addEventListener('change', sync);
    pointer.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
      pointer.removeEventListener('change', sync);
    };
  });
  const COL_W = 188;
  const COL_W_QUIET = 84;
  const COL_GAP = 26;
  const GROUP_GAP = 96;
  const PAD = 32;
  const TOP = 18;
  const FULL_H = 68;
  const THIN_H = 14;
  const FULL_GAP = 10;
  const THIN_GAP = 4;
  const GROUP_COL_GAP = 64;
  const GROUP_ROW_GAP = 18;
  const GROUP_SIDE_GAP = 24;
  const GROUP_BAND_GAP = 76;
  const HEAD_H = 58;
  const MID = 0.7;
  const NEAR = 0.9;
  // In a group: the chosen card opens to this width and is framed no smaller than READ_K; a line
  // that skips a band keeps a lane (LANE wide, LANE_CLEAR from cards, LANE_GAP from other lanes)
  // and bends into it BEND before the band; lines share a card's side at PORT_STEP apart.
  const FOCUS_W = 320;
  const READ_K = 0.8;
  const LANE = 4;
  const LANE_CLEAR = 18;
  const LANE_GAP = 12;
  const BEND = 8;
  const PORT_INSET = 12;
  const PORT_STEP = 14;
  const PORT_STEP_WIDE = 24;

  interface Cell {
    key: string;
    kind: EvidenceKind;
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    full: boolean;
    order: number;
  }
  interface Column {
    key: string;
    kind: 'hearing' | 'findings' | 'document';
    id: string;
    x: number;
    w: number;
    name: string;
    short: string;
    live: boolean;
    count: number;
    cells: Cell[];
  }
  interface Pose {
    x: number;
    y: number;
    w: number;
    h: number;
    o: number;
  }

  let grouped = $derived(picked.length > 0);
  let linked = $derived(new Set(pairings.flatMap((p) => [p.from, p.to])));
  let shown = $derived(pairings.filter((p) => !hidden.includes(p.relation)));
  let relCounts = $derived(
    relations.map((r) => ({ r, n: pairings.filter((p) => p.relation === r).length })).filter((x) => x.n > 0)
  );
  let shownBy = $derived.by(() => {
    const m = new Map<string, Pairing[]>();
    for (const p of shown) for (const k of [p.from, p.to]) m.set(k, [...(m.get(k) ?? []), p]);
    return m;
  });
  const strongest = (list: Pairing[] | undefined) =>
    list?.length ? relations.find((r) => list.some((p) => p.relation === r)) : undefined;

  // The overview: hearings, then findings, then documents, each in its own order.
  let layout = $derived.by(() => {
    const columns: Column[] = [];
    const cells = new Map<string, Cell>();
    let x = PAD;
    let bottom = TOP;
    let order = 0;
    const place = (
      kind: Column['kind'],
      id: string,
      name: string,
      short: string,
      live: boolean,
      items: { kind: EvidenceKind; id: string }[]
    ) => {
      const keys = items.map((it) => `${it.kind}:${it.id}`);
      const w = keys.some((k) => linked.has(k)) ? COL_W : COL_W_QUIET;
      const col: Column = { key: `${kind}:${id}`, kind, id, x, w, name, short, live, count: 0, cells: [] };
      let y = TOP;
      items.forEach((it, i) => {
        const full = linked.has(keys[i]);
        const cell: Cell = {
          key: keys[i],
          kind: it.kind,
          id: it.id,
          x,
          y,
          w,
          h: full ? FULL_H : THIN_H,
          full,
          order: order++
        };
        col.cells.push(cell);
        cells.set(cell.key, cell);
        y += cell.h + (full ? FULL_GAP : THIN_GAP);
      });
      const own = new Set(keys);
      col.count = pairings.filter((p) => own.has(p.from) || own.has(p.to)).length;
      columns.push(col);
      bottom = Math.max(bottom, y);
      x += w + COL_GAP;
    };
    const hearings = workspace.hearings;
    for (const h of hearings) {
      place(
        'hearing',
        h.id,
        t('common.hearingN', { n: h.number }),
        String(h.number),
        h.mode === 'live',
        statementsOf(h.id).map((s) => ({ kind: 'statement' as const, id: s.id }))
      );
    }
    const found = workspace.findings;
    if (found.length) {
      if (columns.length) x += GROUP_GAP - COL_GAP;
      place(
        'findings',
        'all',
        t('nav.findings'),
        '',
        false,
        found.map((f) => ({ kind: 'finding' as const, id: f.id }))
      );
    }
    const docs = workspace.documents;
    if (columns.length && docs.length) x += GROUP_GAP - COL_GAP;
    for (const d of docs)
      place(
        'document',
        d.id,
        d.title,
        '',
        false,
        passagesOf(d.id).map((p) => ({ kind: 'passage' as const, id: p.id }))
      );
    return { columns, cells, width: Math.max(x - COL_GAP + PAD, 1), height: bottom + PAD };
  });
  let selectedColumn = $state('');
  let previewColumn = $state('');
  // Relation names lead a chip, so they start with a capital.
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

  // The chosen piece of evidence opens up in its group to show all of it (its height is measured
  // from what it holds); the rest of the group keeps the compact cards.
  let focus = $derived(grouped && picked.length === 1 && layout.cells.has(picked[0]) ? picked[0] : undefined);
  let focusCell = $derived(focus ? layout.cells.get(focus) : undefined);
  let focusH = $state(0);
  const sizeOf = (key: string) =>
    key === focus ? { w: FOCUS_W, h: Math.max(FULL_H, focusH || FULL_H * 2) } : { w: COL_W, h: FULL_H };

  interface Arranged {
    poses: Map<string, Pose>;
    heads: { kind: EvidenceKind; x: number; y: number; n: number }[];
    bounds: Bounds;
    rows: boolean;
    /** The band each card sits in, and each band's span across (x for columns, y for rows). */
    band: Map<string, number>;
    spans: { at: number; size: number }[];
    /** For a line that skips bands: where it crosses each band it passes through. */
    lanes: Map<string, Map<number, number>>;
  }

  /** Places items along a line in their order, each clear of the next, as near their ideal places as can be. */
  function pack<T extends { ideal: number; size: number }>(list: T[], gap: (a: T, b: T) => number) {
    const runs: { first: number; offs: number[]; at: number }[] = [];
    list.forEach((it, i) => {
      let cur = { first: i, offs: [0], at: it.ideal };
      while (runs.length) {
        const prev = runs[runs.length - 1];
        const last = prev.first + prev.offs.length - 1;
        const lastOff = prev.offs[prev.offs.length - 1];
        const need = list[last].size / 2 + gap(list[last], list[cur.first]) + list[cur.first].size / 2;
        if (cur.at - (prev.at + lastOff) >= need) break;
        // Touching: one run, placed where its items' ideal places average out.
        prev.offs.push(...cur.offs.map((o) => lastOff + need + o));
        prev.at = prev.offs.reduce((s, o, k) => s + list[prev.first + k].ideal - o, 0) / prev.offs.length;
        runs.pop();
        cur = prev;
      }
      runs.push(cur);
    });
    return runs.flatMap((r) => r.offs.map((o) => r.at + o));
  }

  // The group: its evidence by kind (lines, findings, passages) around where it sits on the
  // overview, as columns or as rows, whichever this view shows larger. Where a line skips a band
  // (a line from a hearing to a passage, past the findings) the band keeps a lane for it between
  // its cards, and the cards make room, so no line runs over a card.
  function arrange(bands: Cell[][], rows: boolean, cx: number, cy: number, links: Pairing[]): Arranged {
    const band = new Map<string, number>();
    bands.forEach((b, i) => b.forEach((c) => band.set(c.key, i)));
    // Across: from band to band. Along: within a band.
    const across = (k: string) => (rows ? sizeOf(k).h : sizeOf(k).w);
    const along = (k: string) => (rows ? sizeOf(k).w : sizeOf(k).h);
    const bandGap = rows ? GROUP_BAND_GAP : GROUP_COL_GAP;
    const cardGap = rows ? GROUP_SIDE_GAP : GROUP_ROW_GAP;
    const sizes = bands.map((b) => Math.max(...b.map((c) => across(c.key))));
    const spans: { at: number; size: number }[] = [];
    let at = (rows ? cy : cx) - (sizes.reduce((s, x) => s + x, 0) + (bands.length - 1) * bandGap) / 2;
    for (const size of sizes) {
      spans.push({ at, size });
      at += size + bandGap;
    }
    // First each band stacked about the middle.
    const centre = new Map<string, number>();
    for (const b of bands) {
      let c0 = (rows ? cx : cy) - (b.reduce((s, c) => s + along(c.key), 0) + (b.length - 1) * cardGap) / 2;
      for (const c of b) {
        centre.set(c.key, c0 + along(c.key) / 2);
        c0 += along(c.key) + cardGap;
      }
    }
    // Then a lane where each skipping line would cross a band, and the band packed around it.
    type Item = { key: string; ideal: number; size: number; lane: boolean };
    const items: Item[][] = bands.map((b) =>
      b.map((c) => ({ key: c.key, ideal: centre.get(c.key)!, size: along(c.key), lane: false }))
    );
    const mid = (i: number) => spans[i].at + spans[i].size / 2;
    for (const pr of links) {
      const ia = band.get(pr.from);
      const ib = band.get(pr.to);
      if (ia === undefined || ib === undefined || Math.abs(ia - ib) < 2) continue;
      const [lo, hi, from, to] = ia < ib ? [ia, ib, pr.from, pr.to] : [ib, ia, pr.to, pr.from];
      for (let i = lo + 1; i < hi; i++) {
        const f = (mid(i) - mid(lo)) / (mid(hi) - mid(lo));
        items[i].push({
          key: pr.key,
          ideal: centre.get(from)! + (centre.get(to)! - centre.get(from)!) * f,
          size: LANE,
          lane: true
        });
      }
    }
    const lanes = new Map<string, Map<number, number>>();
    items.forEach((list, i) => {
      if (!list.some((it) => it.lane)) return;
      list.sort((x, y) => x.ideal - y.ideal);
      const placed = pack(list, (x, y) => (x.lane && y.lane ? LANE_GAP : x.lane || y.lane ? LANE_CLEAR : cardGap));
      list.forEach((it, j) => {
        if (it.lane) lanes.set(it.key, (lanes.get(it.key) ?? new Map<number, number>()).set(i, placed[j]));
        else centre.set(it.key, placed[j]);
      });
    });
    // Each card centred in its band.
    const poses = new Map<string, Pose>();
    bands.forEach((b, i) => {
      for (const c of b) {
        const { w, h } = sizeOf(c.key);
        const a = spans[i].at + (spans[i].size - (rows ? h : w)) / 2;
        const s = centre.get(c.key)! - (rows ? w : h) / 2;
        poses.set(c.key, rows ? { x: s, y: a, w, h, o: 1 } : { x: a, y: s, w, h, o: 1 });
      }
    });
    // A band's type tag sits above its column, or left of its row, clear of the lanes through it.
    const heads = bands.map((b, i) => {
      const through = [...lanes.values()].flatMap((l) => (l.has(i) ? [l.get(i)! - LANE_CLEAR] : []));
      const start = Math.min(...b.map((c) => (rows ? poses.get(c.key)!.x : poses.get(c.key)!.y)), ...through);
      return rows
        ? { kind: b[0].kind, x: start, y: mid(i), n: b.length }
        : { kind: b[0].kind, x: spans[i].at, y: start, n: b.length };
    });
    const all = [...poses.values()];
    const laneEnds = [...lanes.values()].flatMap((l) => [...l.values()].map((v) => v + LANE_CLEAR));
    const bounds: Bounds = rows
      ? {
          x0: Math.min(...heads.map((h) => h.x)) - 150,
          y0: Math.min(...all.map((q) => q.y)) - 24,
          x1: Math.max(...all.map((q) => q.x + q.w), ...laneEnds) + 24,
          y1: Math.max(...all.map((q) => q.y + q.h)) + 24
        }
      : {
          x0: Math.min(...all.map((q) => q.x)) - 24,
          y0: Math.min(...heads.map((h) => h.y)) - 52,
          x1: Math.max(...all.map((q) => q.x + q.w)) + 24,
          y1: Math.max(...all.map((q) => q.y + q.h), ...laneEnds) + 24
        };
    return { poses, heads, bounds, rows, band, spans, lanes };
  }
  let gathered = $derived.by(() => {
    if (!grouped) return null;
    const cells = [...members]
      .map((k) => layout.cells.get(k))
      .filter((c): c is Cell => !!c)
      .sort((a, b) => a.order - b.order);
    if (!cells.length) return null;
    const kinds: EvidenceKind[] = ['statement', 'finding', 'passage'];
    const bands = kinds.map((k) => cells.filter((c) => c.kind === k)).filter((c) => c.length);
    // Each band after the first follows where its pairings point (the mean place of its partners
    // in the bands before it), so lines run straight rather than across one another.
    const place = new Map(bands[0].map((c, i) => [c.key, i]));
    for (const band of bands.slice(1)) {
      const at = (c: Cell) => {
        const ps = pairings
          .flatMap((pr) => (pr.from === c.key ? [pr.to] : pr.to === c.key ? [pr.from] : []))
          .map((k) => place.get(k))
          .filter((i): i is number => i !== undefined);
        return ps.length ? ps.reduce((x, y) => x + y, 0) / ps.length : Infinity;
      };
      band.sort((a, b) => at(a) - at(b) || a.order - b.order);
      band.forEach((c, i) => place.set(c.key, i));
    }
    const cx = (Math.min(...cells.map((c) => c.x)) + Math.max(...cells.map((c) => c.x + c.w))) / 2;
    const cy = (Math.min(...cells.map((c) => c.y)) + Math.max(...cells.map((c) => c.y + c.h))) / 2;
    const cols = arrange(bands, false, cx, cy, shown);
    const rows = arrange(bands, true, cx, cy, shown);
    const fit = (b: Bounds) => Math.min((pz.vw - 56) / (b.x1 - b.x0), (pz.vh - 56) / (b.y1 - b.y0));
    return fit(rows.bounds) > fit(cols.bounds) * 1.05 ? rows : cols;
  });

  // Where every cell should be: on the overview, or gathered (the rest fade where they are).
  let targets = $derived.by(() => {
    const out = new Map<string, Pose>();
    for (const c of layout.cells.values()) {
      const g = gathered?.poses.get(c.key);
      out.set(c.key, g ?? { x: c.x, y: c.y, w: c.w, h: c.h, o: gathered ? 0 : 1 });
    }
    return out;
  });

  // Cells glide from wherever they are to their targets; a change mid-way starts from there.
  let from = $state.raw(new Map<string, Pose>());
  let to = $state.raw(new Map<string, Pose>());
  let p = $state(1);
  let tween = 0;
  const ease = (x: number) => 1 - (1 - x) ** 3;
  function poseOf(key: string): Pose | undefined {
    const b = to.get(key);
    const a = from.get(key);
    if (!b || !a || p >= 1) return b;
    const e = ease(p);
    return {
      x: a.x + (b.x - a.x) * e,
      y: a.y + (b.y - a.y) * e,
      w: a.w + (b.w - a.w) * e,
      h: a.h + (b.h - a.h) * e,
      o: a.o + (b.o - a.o) * e
    };
  }
  $effect(() => {
    const next = targets;
    const animate = motionOk;
    untrack(() => {
      const now = new Map<string, Pose>();
      for (const k of next.keys()) {
        const cur = poseOf(k);
        if (cur) now.set(k, cur);
      }
      cancelAnimationFrame(tween);
      from = now;
      to = next;
      if (!animate || !now.size) {
        p = 1;
        return;
      }
      p = 0;
      const t0 = performance.now();
      const step = (time: number) => {
        p = Math.min(1, (time - t0) / 640);
        if (p < 1) tween = requestAnimationFrame(step);
      };
      tween = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(tween);
  });

  const pz = new PanZoom({ top: HEAD_H });
  $effect(() => {
    pz.top = grouped ? 0 : HEAD_H;
  });
  let zoom = $derived(pz.k < MID ? 'far' : pz.k < NEAR ? 'mid' : 'near');

  function overview() {
    const f = pz.frame({ x0: 0, y0: 0, x1: layout.width, y1: layout.height }, pz.vw < 600 ? 0.3 : 0.2, 1);
    if (layout.width * f.k > pz.vw - 16) f.x = 0;
    if (layout.height * f.k > pz.vh - HEAD_H - 16) f.y = HEAD_H;
    return f;
  }
  function showAll() {
    selectedColumn = '';
    pz.flyTo(grouped && gathered ? pz.frame(gathered.bounds, 0.3, 1.2) : overview());
  }

  // The camera follows the selection: the gathered group, or the whole case. A group too big to
  // read whole is framed around the open card instead, at a zoom where it reads.
  function groupView() {
    const g = gathered!;
    const f = pz.frame(g.bounds, 0.3, 1.2);
    const q = focus ? g.poses.get(focus) : undefined;
    if (!q || f.k >= READ_K) return f;
    return pz.frame({ x0: q.x - 140, y0: q.y - 90, x1: q.x + q.w + 140, y1: q.y + q.h + 50 }, READ_K, 1.2);
  }
  $effect(() => {
    const key = selected;
    const tall = focusH;
    const duration = motionOk ? 640 : 0;
    if (!pz.vw || !pz.vh) return;
    untrack(() => {
      void key;
      void tall;
      pz.flyTo(gathered ? groupView() : overview(), duration);
    });
  });

  let view: HTMLElement | undefined = $state();
  $effect(() => {
    if (!view) return;
    return pz.attach(view, { ignore: '.heads,a', noZoom: '.cell, .heads', onpan: () => (hovered = null) });
  });

  /** A pairing's line leaves from the sides the two cards face each other with. */
  function path(pr: Pairing) {
    const a = poseOf(pr.from);
    const b = poseOf(pr.to);
    if (!a || !b) return '';
    const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (overlapX > 0 && overlapY <= 0) {
      const [u, v] = a.y <= b.y ? [a, b] : [b, a];
      // Neighbours one above the other: straight down.
      if (v.y - (u.y + u.h) < FULL_H * 2) {
        const x = (Math.max(u.x, v.x) + Math.min(u.x + u.w, v.x + v.w)) / 2;
        return `M${x},${u.y + u.h} L${x},${v.y}`;
      }
      // Further apart: a bow on the outer side, clear of the cards between them.
      const uy = u.y + u.h / 2;
      const vy = v.y + v.h / 2;
      const bow = 44 + Math.abs(vy - uy) * 0.18;
      const outLeft = !!gathered && u.x + u.w / 2 < (gathered.bounds.x0 + gathered.bounds.x1) / 2;
      if (outLeft) {
        const sx = Math.min(u.x, v.x);
        return `M${u.x},${uy} C${sx - bow},${uy} ${sx - bow},${vy} ${v.x},${vy}`;
      }
      const sx = Math.max(u.x + u.w, v.x + v.w);
      return `M${u.x + u.w},${uy} C${sx + bow},${uy} ${sx + bow},${vy} ${v.x + v.w},${vy}`;
    }
    if (-overlapX >= -overlapY) {
      const [l, r] = a.x <= b.x ? [a, b] : [b, a];
      const ly = l.y + l.h / 2;
      const ry = r.y + r.h / 2;
      const sx = l.x + l.w;
      const dx = Math.max(36, (r.x - sx) * 0.5);
      return `M${sx},${ly} C${sx + dx},${ly} ${r.x - dx},${ry} ${r.x},${ry}`;
    }
    const [u, v] = a.y <= b.y ? [a, b] : [b, a];
    const ux = u.x + u.w / 2;
    const vx = v.x + v.w / 2;
    const sy = u.y + u.h;
    const dy = Math.max(30, (v.y - sy) * 0.5);
    return `M${ux},${sy} C${ux},${sy + dy} ${vx},${v.y - dy} ${vx},${v.y}`;
  }
  const seen = (pr: Pairing) => Math.min(poseOf(pr.from)?.o ?? 0, poseOf(pr.to)?.o ?? 0);

  type Side = 'l' | 'r' | 't' | 'b';
  interface Leg {
    pr: Pairing;
    kind: 'stack' | 'bow' | 'cross' | 'skip';
    ends: { key: string; side: Side; toward: number }[];
  }

  // In a group every line leaves its card at a point of its own along a side, in the order the
  // lines head off, so none start on top of one another; a line that skips a band runs through the
  // lane kept for it there, clear of the cards.
  let routes = $derived.by(() => {
    const out = new Map<string, { d: string; skip: boolean }>();
    const g = gathered;
    if (!g) return out;
    const settle = p >= 1 ? 1 : ease(p);
    const midX = (q: Pose) => q.x + q.w / 2;
    const midY = (q: Pose) => q.y + q.h / 2;
    const along = (q: Pose) => (g.rows ? midX(q) : midY(q));
    const legs: Leg[] = [];
    for (const pr of shown) {
      const ia = g.band.get(pr.from);
      const ib = g.band.get(pr.to);
      const a = poseOf(pr.from);
      const b = poseOf(pr.to);
      if (ia === undefined || ib === undefined || !a || !b) continue;
      const [lo, hi, ql, qh] = ia <= ib ? [pr.from, pr.to, a, b] : [pr.to, pr.from, b, a];
      if (Math.abs(ia - ib) >= 2) {
        const lane = g.lanes.get(pr.key);
        if (!lane) continue;
        const first = Math.min(ia, ib) + 1;
        const last = Math.max(ia, ib) - 1;
        legs.push({
          pr,
          kind: 'skip',
          ends: [
            { key: lo, side: g.rows ? 'b' : 'r', toward: lane.get(first)! },
            { key: hi, side: g.rows ? 't' : 'l', toward: lane.get(last)! }
          ]
        });
        continue;
      }
      if (ia === ib) {
        const [p0, p1] = [along(a), along(b)].sort((x, y) => x - y);
        const between = [...g.band].some(([k, i]) => {
          if (i !== ia || k === pr.from || k === pr.to) return false;
          const q = poseOf(k);
          return !!q && along(q) > p0 && along(q) < p1;
        });
        if (between) {
          // Round the outside of the group, clear of the cards between them.
          const side: Side = g.rows
            ? midY(a) < (g.bounds.y0 + g.bounds.y1) / 2
              ? 't'
              : 'b'
            : midX(a) < (g.bounds.x0 + g.bounds.x1) / 2
              ? 'l'
              : 'r';
          legs.push({
            pr,
            kind: 'bow',
            ends: [
              { key: pr.from, side, toward: along(b) },
              { key: pr.to, side, toward: along(a) }
            ]
          });
          continue;
        }
        if (!g.rows) {
          legs.push({ pr, kind: 'stack', ends: [] });
          continue;
        }
      }
      // Neighbouring bands, once in order: the sides that face across the gap between them.
      if (ia !== ib && (g.rows ? ql.y + ql.h <= qh.y : ql.x + ql.w <= qh.x)) {
        legs.push(
          g.rows
            ? {
                pr,
                kind: 'cross',
                ends: [
                  { key: lo, side: 'b', toward: midX(qh) },
                  { key: hi, side: 't', toward: midX(ql) }
                ]
              }
            : {
                pr,
                kind: 'cross',
                ends: [
                  { key: lo, side: 'r', toward: midY(qh) },
                  { key: hi, side: 'l', toward: midY(ql) }
                ]
              }
        );
        continue;
      }
      // Still on their way, or side by side in a row: the sides they face each other with now.
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (!(overlapX > 0 && overlapY <= 0) && -overlapX >= -overlapY) {
        const [l, r, qa, qb] = a.x <= b.x ? [pr.from, pr.to, a, b] : [pr.to, pr.from, b, a];
        legs.push({
          pr,
          kind: 'cross',
          ends: [
            { key: l, side: 'r', toward: midY(qb) },
            { key: r, side: 'l', toward: midY(qa) }
          ]
        });
      } else {
        const [u, v, qa, qb] = a.y <= b.y ? [pr.from, pr.to, a, b] : [pr.to, pr.from, b, a];
        legs.push({
          pr,
          kind: 'cross',
          ends: [
            { key: u, side: 'b', toward: midX(qb) },
            { key: v, side: 't', toward: midX(qa) }
          ]
        });
      }
    }
    // The lines on one side of a card share it out, in the order they head off.
    const sides = new Map<string, { leg: Leg; end: number }[]>();
    for (const leg of legs) {
      leg.ends.forEach((e, end) => {
        const k = `${e.key} ${e.side}`;
        sides.set(k, [...(sides.get(k) ?? []), { leg, end }]);
      });
    }
    const offset = new Map<string, number>();
    for (const [k, list] of sides) {
      const [key, side] = k.split(' ');
      const q = poseOf(key)!;
      const upright = side === 'l' || side === 'r';
      list.sort((x, y) => x.leg.ends[x.end].toward - y.leg.ends[y.end].toward);
      const step =
        list.length > 1
          ? Math.min(
              upright ? PORT_STEP : PORT_STEP_WIDE,
              ((upright ? q.h : q.w) - 2 * PORT_INSET) / (list.length - 1)
            )
          : 0;
      list.forEach((it, i) =>
        offset.set(`${it.leg.pr.key} ${it.end}`, (i - (list.length - 1) / 2) * step * settle)
      );
    }
    const port = (leg: Leg, end: number): [number, number] => {
      const e = leg.ends[end];
      const q = poseOf(e.key)!;
      const o = offset.get(`${leg.pr.key} ${end}`) ?? 0;
      if (e.side === 'l') return [q.x, midY(q) + o];
      if (e.side === 'r') return [q.x + q.w, midY(q) + o];
      if (e.side === 't') return [midX(q) + o, q.y];
      return [midX(q) + o, q.y + q.h];
    };
    for (const leg of legs) {
      const { pr } = leg;
      if (leg.kind === 'stack') {
        out.set(pr.key, { d: path(pr), skip: false });
        continue;
      }
      const [x0, y0] = port(leg, 0);
      const [x1, y1] = port(leg, 1);
      const side = leg.ends[0].side;
      let d = `M${x0},${y0}`;
      if (leg.kind === 'cross' && side === 'r') {
        const dx = Math.max(36, (x1 - x0) * 0.5);
        d += ` C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`;
      } else if (leg.kind === 'cross') {
        const dy = Math.max(30, (y1 - y0) * 0.5);
        d += ` C${x0},${y0 + dy} ${x1},${y1 - dy} ${x1},${y1}`;
      } else if (leg.kind === 'bow') {
        const a = poseOf(pr.from)!;
        const b = poseOf(pr.to)!;
        if (side === 'l' || side === 'r') {
          const bow = 44 + Math.abs(y1 - y0) * 0.18;
          const sx = side === 'l' ? Math.min(a.x, b.x) - bow : Math.max(a.x + a.w, b.x + b.w) + bow;
          d += ` C${sx},${y0} ${sx},${y1} ${x1},${y1}`;
        } else {
          const bow = 44 + Math.abs(x1 - x0) * 0.18;
          const sy = side === 't' ? Math.min(a.y, b.y) - bow : Math.max(a.y + a.h, b.y + b.h) + bow;
          d += ` C${x0},${sy} ${x1},${sy} ${x1},${y1}`;
        }
      } else {
        // Through each band it skips, in its lane: it bends into the lane in the gap before the
        // band, runs straight across, and bends out again.
        const lane = g.lanes.get(pr.key)!;
        let px = x0;
        let py = y0;
        for (let i = g.band.get(leg.ends[0].key)! + 1; i < g.band.get(leg.ends[1].key)!; i++) {
          const c = lane.get(i)!;
          const { at, size } = g.spans[i];
          if (g.rows) {
            const k = (at - BEND - py) / 2;
            d += ` C${px},${py + k} ${c},${at - BEND - k} ${c},${at - BEND} L${c},${at + size + BEND}`;
            px = c;
            py = at + size + BEND;
          } else {
            const k = (at - BEND - px) / 2;
            d += ` C${px + k},${py} ${at - BEND - k},${c} ${at - BEND},${c} L${at + size + BEND},${c}`;
            px = at + size + BEND;
            py = c;
          }
        }
        d += g.rows
          ? ` C${px},${(py + y1) / 2} ${x1},${(py + y1) / 2} ${x1},${y1}`
          : ` C${(px + x1) / 2},${py} ${(px + x1) / 2},${y1} ${x1},${y1}`;
      }
      out.set(pr.key, { d, skip: leg.kind === 'skip' });
    }
    return out;
  });
  // A line that skips a band appears as the cards settle, since its lane is where they end up.
  let skipFade = $derived(p >= 1 ? 1 : Math.max(0, (p - 0.7) / 0.3));
  const routeOf = (pr: Pairing) => (grouped ? routes.get(pr.key) : undefined);

  function describe(c: Cell) {
    if (c.kind === 'statement') {
      const s = statement(c.id);
      const sp = speaker(s?.speakerId ?? '');
      return {
        meta: s ? `${shortName(sp) || speakerName(sp)} · ${fmtClock(s.t)}` : '',
        glyph: s ? fmtClock(s.t) : '',
        text: s?.text ?? '',
        speakerId: s?.speakerId,
        icon: 'statement' as Kind
      };
    }
    if (c.kind === 'passage') {
      const pa = passage(c.id);
      return {
        meta: pa ? t('common.page', { n: pa.page }) : '',
        glyph: pa ? t('common.page', { n: pa.page }) : '',
        text: pa?.text ?? '',
        speakerId: undefined,
        icon: 'passage' as Kind
      };
    }
    const f = finding(c.id);
    const s = f ? statement(f.statementId) : undefined;
    return {
      meta: f ? t(`status.${f.status}`) : '',
      glyph: s ? fmtClock(s.t) : '',
      text: l(f?.title),
      speakerId: undefined,
      icon: 'finding' as Kind
    };
  }
  /** All of one piece of evidence, for the open card: who or where, the words, and where to see it. */
  function detail(c: Cell) {
    const n = shownBy.get(c.key)?.length ?? 0;
    if (c.kind === 'statement') {
      const s = statement(c.id);
      const h = hearing(s?.hearingId);
      return {
        icon: 'statement' as Kind,
        speakerId: s?.speakerId,
        n,
        title: speakerName(speaker(s?.speakerId ?? '')),
        sub: s && h ? `${t('common.hearingN', { n: h.number })} · ${fmtClock(s.t)}` : '',
        heading: '',
        text: s?.text ?? '',
        open: t('fx.openInHearing'),
        href: s
          ? casePath(workspace) + '/hearings/' + encodeURIComponent(s.hearingId) + '?s=' + encodeURIComponent(s.id)
          : ''
      };
    }
    if (c.kind === 'passage') {
      const pa = passage(c.id);
      return {
        icon: 'passage' as Kind,
        speakerId: undefined,
        n,
        title: pa ? (doc(pa.docId)?.title ?? '') : '',
        sub: pa ? t('common.page', { n: pa.page }) : '',
        heading: '',
        text: pa?.text ?? '',
        open: t('fx.openDoc'),
        href: pa
          ? casePath(workspace) + '/documents/' + encodeURIComponent(pa.docId) + '?p=' + encodeURIComponent(pa.id)
          : ''
      };
    }
    // A finding is worked on in Temuan only: here it reads in full and links there.
    const f = finding(c.id);
    const s = f ? statement(f.statementId) : undefined;
    const h = hearing(f?.hearingId);
    return {
      icon: 'finding' as Kind,
      speakerId: undefined,
      n,
      title: f ? t(`status.${f.status}`) : '',
      sub: s && h ? `${t('common.hearingN', { n: h.number })} · ${fmtClock(s.t)}` : '',
      heading: l(f?.title),
      text: l(f?.explanation),
      open: t('fl.open'),
      href: f ? findingPath(f.id) : ''
    };
  }
  function relOf(c: Cell): Relation | undefined {
    if (c.kind === 'finding') {
      const f = finding(c.id);
      return f ? statusRelation[f.status] : undefined;
    }
    return c.full || grouped ? strongest(shownBy.get(c.key)) : undefined;
  }
  function label(c: Cell) {
    const n = shownBy.get(c.key)?.length ?? 0;
    return `${whereOf(c.key)}: ${describe(c).text}${n ? ` · ${t('cx.map.count', { n })}` : ''}`;
  }

  // Keyboard: one tab stop; the arrow keys move to the nearest cell that way, Enter chooses it.
  let active = $state<string | null>(null);
  let hovered = $state<string | null>(null);
  let keyed = $state<string | null>(null);
  let buttons = $state<Record<string, HTMLElement>>({});
  const visible = (k: string) => (to.get(k)?.o ?? 0) > 0.5;
  let firstKey = $derived(
    [...layout.cells.values()].find((c) => visible(c.key) && (c.full || grouped))?.key ?? null
  );
  let tabKey = $derived(active && visible(active) ? active : (picked.find(visible) ?? firstKey));
  function nearest(key: string, dir: string) {
    const a = to.get(key);
    if (!a) return undefined;
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    let best: string | undefined;
    let score = Infinity;
    for (const [k, b] of to) {
      if (k === key || b.o < 0.5) continue;
      const dx = b.x + b.w / 2 - ax;
      const dy = b.y + b.h / 2 - ay;
      const along = dir === 'ArrowDown' ? dy : dir === 'ArrowUp' ? -dy : dir === 'ArrowRight' ? dx : -dx;
      const across = dir === 'ArrowDown' || dir === 'ArrowUp' ? Math.abs(dx) : Math.abs(dy);
      if (along < 1) continue;
      const s = along + across * 2.5;
      if (s < score) {
        score = s;
        best = k;
      }
    }
    return best;
  }
  function oncellkey(e: KeyboardEvent, c: Cell) {
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const n = nearest(c.key, e.key);
      if (!n) return;
      active = n;
      buttons[n]?.focus({ preventScroll: true });
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      pz.zoomBy(1.35);
    } else if (e.key === '-') {
      e.preventDefault();
      pz.zoomBy(1 / 1.35);
    } else if (e.key === '0') {
      e.preventDefault();
      showAll();
    } else if (e.key === 'Escape' && grouped) {
      e.preventDefault();
      onchoose('', true);
    }
  }
  function choose(c: Cell, keyboard = false) {
    if (!keyboard && pz.dragged) return;
    active = c.key;
    onchoose(c.key, keyboard);
  }
  function onheader(col: Column, keyboard: boolean) {
    if (!col.cells.length) {
      const section = col.kind === 'document' ? '/documents/' : '/hearings/';
      void goto(casePath(workspace) + section + encodeURIComponent(col.id));
      return;
    }
    selectedColumn = col.key;
    if (col.kind === 'document') onchoose('document:' + col.id, keyboard);
    else {
      const cs = col.cells;
      pz.flyTo(
        pz.frame(
          {
            x0: col.x - 20,
            y0: cs[0].y - 20,
            x1: col.x + col.w + 20,
            y1: cs[cs.length - 1].y + cs[cs.length - 1].h + 20
          },
          0.3,
          1.15
        )
      );
    }
  }

  let preview = $derived(hovered ?? keyed);
  let lifted = $derived(
    grouped
      ? shown.filter((pr) => picked.includes(pr.from) || picked.includes(pr.to))
      : preview
        ? shown.filter((pr) => pr.from === preview || pr.to === preview)
        : []
  );
  let liftedKeys = $derived(new Set(lifted.map((pr) => pr.key)));
  let peek = $derived(!grouped && preview && pz.k < NEAR ? layout.cells.get(preview) : undefined);
  let tagW = $state<Record<string, number>>({});
  const typeName: Record<EvidenceKind, Parameters<typeof t>[0]> = {
    statement: 'nav.hearings',
    finding: 'nav.findings',
    passage: 'nav.documents'
  };
  const typeIcon: Record<EvidenceKind, Kind> = { statement: 'hearing', finding: 'finding', passage: 'document' };
</script>

{#snippet opened(c: Cell)}
  {@const d = detail(c)}
  <span class="o-head">
    <KindIcon
      speakers={workspace.speakers}
      kind={d.icon}
      speakerId={d.speakerId}
      size={c.kind === 'statement' ? 26 : 17}
    />
    <span class="o-title">{d.title}</span>
    {#if d.n}<span class="n tabular">{d.n}</span>{/if}
  </span>
  {#if d.sub}<span class="o-sub tabular">{d.sub}</span>{/if}
  {#if d.heading}<span class="o-heading">{d.heading}</span>{/if}
  {#if d.text}<span class="o-text" lang={c.kind === 'finding' ? lang : 'id'} class:doc-text={c.kind === 'passage'}
      >{d.text}</span
    >{/if}
  {#if d.href}<a class="link-btn o-go" href={d.href}>{d.open}<ArrowRight size={13} aria-hidden="true" /></a>{/if}
{/snippet}

<div class="map-wrap" data-tour="connections-map">
  <div class="bar">
    {#if grouped}
      <button class="btn btn-sm" onclick={() => onchoose('', true)}><ArrowLeft size={14} />{t('cx.map.all')}</button
      >
    {/if}
    <button class="btn btn-sm" onclick={onpick}><Search size={14} />{t('cx.map.pick')}</button>
    {#if relCounts.length}
      <div class="rels" role="group" aria-label={t('cx.map.relations')}>
        {#each relCounts as x (x.r)}
          <button
            class="chip rel"
            data-filter={x.r}
            aria-pressed={!hidden.includes(x.r)}
            onclick={() => (hidden = hidden.includes(x.r) ? hidden.filter((r) => r !== x.r) : [...hidden, x.r])}
          >
            <i class="swatch" data-rel={x.r} aria-hidden="true"></i>{cap(t(`rel.${x.r}`))}
            <span class="count">{x.n}</span>
          </button>
        {/each}
      </div>
      <p class="styles xsmall muted">
        <span><svg width="22" height="6" aria-hidden="true"><path d="M1,3 H21" /></svg>{t('cx.confirmed')}</span>
        <span
          ><svg width="22" height="6" aria-hidden="true"><path class="dash" d="M1,3 H21" /></svg>{t(
            'cx.suggested'
          )}</span
        >
      </p>
    {/if}
    <div class="zoom">
      <button
        class="btn btn-sm btn-icon"
        aria-label={t('cx.map.zoomOut')}
        title={t('cx.map.zoomOut')}
        onclick={() => pz.zoomBy(1 / 1.35)}><Minus size={15} /></button
      >
      <button
        class="btn btn-sm btn-icon"
        aria-label={t('cx.map.zoomIn')}
        title={t('cx.map.zoomIn')}
        onclick={() => pz.zoomBy(1.35)}><Plus size={15} /></button
      >
      <button class="btn btn-sm fit" aria-label={t('cx.map.fit')} onclick={showAll}
        ><Maximize2 size={14} /><span class="fit-label">{t('cx.map.fit')}</span></button
      >
    </div>
  </div>

  {#if !layout.columns.length}
    <p class="empty muted">{t('cx.map.empty')}</p>
  {:else}
    <p class="sr-only" id="cx-map-desc">{t('cx.map.desc')}</p>
    <div class="map-frame">
    {#if !grouped}
      <MapColumnIndex columns={layout.columns} {workspace} {lang} selected={selectedColumn}
        choose={onheader} preview={(key) => (previewColumn = key)} />
    {/if}
    <div
      class="view map {zoom}"
      data-progress={p}
      data-orientation={gathered ? (gathered.rows ? 'rows' : 'columns') : 'overview'}
      class:grouped
      bind:this={view}
      bind:clientWidth={pz.vw}
      bind:clientHeight={pz.vh}
      role="group"
      aria-label={grouped ? t('cx.map.groupLabel') : t('cx.map.label')}
      aria-describedby="cx-map-desc"
    >
      <div
        class="world"
        data-scale={pz.k}
        class:moving={pz.moving || p < 1}
        style:transform="translate({pz.x}px, {pz.y}px) scale({pz.k})"
      >
        <div class="dots" style:width="{layout.width + 2400}px" style:height="{layout.height + 2400}px"></div>
        <svg class="edges" width={layout.width} height={layout.height} aria-hidden="true">
          {#each shown as pr (pr.key)}
            {@const o = seen(pr)}
            {@const r = routeOf(pr)}
            {#if o > 0.02 && !liftedKeys.has(pr.key)}
              <path
                data-pair={pr.key}
                data-from={pr.from}
                data-to={pr.to}
                d={r?.d ?? path(pr)}
                data-rel={pr.relation}
                class:suggested={!pr.reviewed}
                class:dim={!grouped && !!preview}
                style:opacity={grouped ? o * (r?.skip ? skipFade : 1) : undefined}
              />
            {/if}
          {/each}
        </svg>
        {#each layout.columns as col (col.key)}
          {#each col.cells as c (c.key)}
            {@const ps = poseOf(c.key)}
            {@const d = describe(c)}
            {@const own = shownBy.get(c.key)}
            {@const card = c.full || (grouped && (ps?.o ?? 0) > 0.5)}
            {#if ps}
              <!-- The chosen piece of evidence is open: a group of its own, holding a link, not a button. -->
              {@const open = c.key === focus}
              <svelte:element
                this={open ? 'div' : 'button'}
                class="cell" class:indexed={!grouped && (previewColumn || selectedColumn) === col.key}
                data-key={c.key}
                class:thin={!card && !open}
                class:open
                class:finding={c.kind === 'finding'}
                class:subject={picked.includes(c.key)}
                class:previewed={preview === c.key}
                data-rel={card || open ? relOf(c) : undefined}
                role={open ? 'group' : undefined}
                style:transform="translate({ps.x}px, {ps.y}px)"
                style:width="{ps.w}px"
                style:height="{ps.h}px"
                inert={ps.o < 0.02}
                style:opacity={ps.o < 1 ? ps.o : undefined}
                style:visibility={ps.o < 0.02 ? 'hidden' : undefined}
                style:pointer-events={ps.o < 0.5 ? 'none' : undefined}
                tabindex={tabKey === c.key ? 0 : -1}
                aria-label={label(c)}
                aria-current={picked.includes(c.key) ? 'true' : undefined}
                bind:this={buttons[c.key]}
                onclick={open ? undefined : (event: MouseEvent) => choose(c, event.detail === 0)}
                onkeydown={(e: KeyboardEvent) => oncellkey(e, c)}
                onfocus={() => {
                  active = c.key;
                  keyed = c.key;
                  const tp = to.get(c.key);
                  if (tp) pz.reveal({ x0: tp.x, y0: tp.y, x1: tp.x + tp.w, y1: tp.y + tp.h }, MID);
                }}
                onblur={() => keyed === c.key && (keyed = null)}
                onpointerenter={(e: PointerEvent) => e.pointerType === 'mouse' && !pz.dragged && (hovered = c.key)}
                onpointerleave={() => hovered === c.key && (hovered = null)}
              >
                {#if open}
                  {@render opened(c)}
                {:else if card}
                  <span class="glyph tabular" aria-hidden="true"
                    ><KindIcon
                      speakers={workspace.speakers}
                      kind={d.icon}
                      speakerId={d.speakerId}
                      size={c.kind === 'statement' ? 30 : 22}
                    /><span>{d.glyph}</span></span
                  >
                  <span class="meta">
                    <KindIcon
                      speakers={workspace.speakers}
                      kind={d.icon}
                      speakerId={d.speakerId}
                      size={c.kind === 'statement' ? 19 : 13}
                    />
                    <span class="who">{grouped && c.kind !== 'finding' ? whereOf(c.key) : d.meta}</span>
                    {#if own?.length}<span class="n tabular">{own.length}</span>{/if}
                  </span>
                  <span
                    class="text clamp-2"
                    lang={c.kind === 'finding' ? lang : 'id'}
                    class:doc-text={c.kind === 'passage'}
                    class:serif={c.kind === 'finding'}>{d.text}</span
                  >
                {:else}
                  <span class="line" class:doc-text={c.kind === 'passage'}>{d.text}</span>
                {/if}
              </svelte:element>
            {/if}
          {/each}
        {/each}
        <svg class="edges lifted" width={layout.width} height={layout.height} aria-hidden="true">
          {#each lifted as pr (pr.key)}
            {@const r = routeOf(pr)}
            <path
              data-pair={pr.key}
              data-from={pr.from}
              data-to={pr.to}
              d={r?.d ?? path(pr)}
              data-rel={pr.relation}
              class:suggested={!pr.reviewed}
              style:opacity={r?.skip && skipFade < 1 ? skipFade : undefined}
            />
          {/each}
        </svg>
      </div>
      {#if focusCell}
        <!-- Measures the open card at its width, so the group can make room for all of it. -->
        <div
          class="cell open measure"
          aria-hidden="true"
          inert
          style:width="{FOCUS_W}px"
          bind:clientHeight={focusH}
        >
          {@render opened(focusCell)}
        </div>
      {/if}

      {#if grouped && gathered}
        {#each gathered.heads as h (h.kind)}
          <!-- Left of a row only where there is room for it (on a phone the panel below lists the kinds). -->
          {@const fits = !gathered.rows || pz.sx(h.x) - 16 - (tagW[h.kind] ?? 0) >= 0}
          <span
            class="type-tag"
            class:side={gathered.rows}
            bind:offsetWidth={tagW[h.kind]}
            style:left="{pz.sx(h.x)}px"
            style:top="{gathered.rows ? pz.sy(h.y) : pz.sy(h.y) - 34}px"
            style:opacity={fits ? p : 0}
          >
            <KindIcon speakers={workspace.speakers} kind={typeIcon[h.kind]} size={14} />{t(typeName[h.kind])}
            <span class="tabular count">{h.n}</span>
          </span>
        {/each}
      {/if}

      {#if peek}
        {@const d = describe(peek)}
        <div
          class="peek"
          style:left="{Math.min(Math.max(8, pz.sx(peek.x)), pz.vw - 296)}px"
          style:top="{Math.max(HEAD_H + 6, pz.sy(peek.y) - 74)}px"
        >
          <span class="where"
            ><KindIcon
              speakers={workspace.speakers}
              kind={d.icon}
              speakerId={d.speakerId}
              size={peek.kind === 'statement' ? 16 : 12}
            />{whereOf(peek.key)}</span
          >
          <span class="clamp-2" class:doc-text={peek.kind === 'passage'}>{d.text}</span>
        </div>
      {/if}
    </div>
    </div>
    <p class="hint xsmall muted">
      {grouped
        ? touch
          ? t('cx.map.groupHintTouch')
          : t('cx.map.groupHint')
        : touch
          ? t('cx.map.hintTouch')
          : t('cx.map.hint')}
    </p>
  {/if}
</div>

<style>
  .map-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }
  .rels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  /* Relation filters wear their kind when on: a tint, a border and a swatch in its colour, so the
     four tell apart from across the room; off, they go plain, muted and struck through. Words stay ink. */
  .bar .chip {
    min-height: calc(var(--hit) - 6px);
  }
  .rel {
    --kind: var(--rel-related);
  }
  .rel:has(.swatch[data-rel='conflicts']) {
    --kind: var(--rel-conflicts);
  }
  .rel:has(.swatch[data-rel='context']) {
    --kind: var(--rel-context);
  }
  .rel:has(.swatch[data-rel='supports']) {
    --kind: var(--rel-supports);
  }
  .rel[aria-pressed='true'] {
    background: color-mix(in srgb, var(--kind) 12%, var(--surface));
    border-color: color-mix(in srgb, var(--kind) 55%, transparent);
    color: var(--ink-strong);
  }
  .rel[aria-pressed='true']:hover {
    background: color-mix(in srgb, var(--kind) 20%, var(--surface));
  }
  .rel .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--kind);
  }
  .rel[aria-pressed='false'] .swatch {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--kind);
  }
  .rel[aria-pressed='false'] {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }
  .rel[aria-pressed='false'] .swatch {
    opacity: 0.35;
  }
  .styles {
    display: flex;
    gap: 12px;
    margin: 0;
  }
  .styles span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .styles path {
    stroke: var(--muted);
    stroke-width: 2;
    fill: none;
  }
  .styles path.dash {
    stroke-dasharray: 5 4;
  }
  .zoom {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .empty {
    padding: 48px 24px;
    text-align: center;
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    background: var(--surface);
  }

  .view {
    position: relative;
    height: var(--map-h, clamp(420px, calc(100dvh - 300px), 860px));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    background: var(--surface-2);
    overflow: hidden;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    contain: strict;
  }
  .view:active {
    cursor: grabbing;
  }
  .world {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    transform-origin: 0 0;
  }
  .world.moving {
    will-change: transform;
  }
  .dots {
    position: absolute;
    left: -1200px;
    top: -1200px;
    pointer-events: none;
    /* Literal colours: an image behind var() would be redrawn every time the camera moves. */
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, var(--muted) 26%, transparent) 1px,
      transparent 1.3px
    );
    background-size: 26px 26px;
  }

  .edges {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
  }
  .edges path {
    fill: none;
    stroke: var(--rel-related);
    stroke-width: 2;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
    transition: opacity 0.2s ease;
  }
  .edges path[data-rel='conflicts'] {
    stroke: var(--rel-conflicts);
  }
  .edges path[data-rel='context'] {
    stroke: var(--rel-context);
  }
  .edges path[data-rel='supports'] {
    stroke: var(--rel-supports);
  }
  .edges path.suggested {
    stroke-dasharray: 6 5;
  }
  .edges path.dim {
    opacity: 0.16;
  }
  .grouped .edges path {
    stroke-width: 2.25;
  }
  .edges.lifted {
    z-index: 3;
  }
  .edges.lifted path {
    stroke-width: 2.75;
  }

  .cell {
    position: absolute;
    left: 0;
    top: 0;
    display: grid;
    align-content: start;
    gap: 3px;
    padding: 8px 10px 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    text-align: left;
    overflow: hidden;
    cursor: pointer;
    transition: box-shadow 0.2s ease;
  }
  .cell[data-rel='conflicts'] {
    background: color-mix(in srgb, var(--rel-conflicts) 13%, var(--surface));
    border-color: color-mix(in srgb, var(--rel-conflicts) 45%, var(--line));
  }
  .cell[data-rel='context'] {
    background: color-mix(in srgb, var(--rel-context) 13%, var(--surface));
    border-color: color-mix(in srgb, var(--rel-context) 45%, var(--line));
  }
  .cell[data-rel='supports'] {
    background: color-mix(in srgb, var(--rel-supports) 12%, var(--surface));
    border-color: color-mix(in srgb, var(--rel-supports) 42%, var(--line));
  }
  .cell[data-rel='related'] {
    border-color: var(--line-strong);
  }
  .cell.finding {
    border-width: 1.5px;
  }
  /* Evidence without a pairing: an outlined tick that keeps the column's shape (not a loading bar). */
  .cell.thin {
    padding: 0 6px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .cell:hover,
  .cell.previewed {
    z-index: 2;
    box-shadow: var(--shadow-float);
  }
  .cell.subject {
    z-index: 4;
    outline: 2px solid var(--ink-strong);
    outline-offset: 2px;
    box-shadow: var(--shadow-float);
  }
  .cell:focus-visible {
    z-index: 5;
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 20px;
    color: var(--ink-strong);
  }
  .who {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .n {
    padding: 0 6px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--ink-strong) 9%, transparent);
    font-size: 11px;
    line-height: 17px;
  }
  .text {
    font-size: 12.5px;
    line-height: 1.38;
    color: var(--ink);
  }
  .text.serif {
    font-family: var(--font-serif);
    font-size: 13.5px;
    line-height: 1.3;
    color: var(--ink-strong);
  }
  .line {
    display: none;
    font-size: 9.5px;
    line-height: 14px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .glyph {
    display: none;
    align-items: center;
    gap: 9px;
    font-size: 22px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  /* Semantic zoom: far out a face and a time, or a page; closer, who or where and a line of the
     words; close up, two lines. */
  .far .cell:not(.thin) {
    align-content: center;
    padding: 0 12px;
  }
  .far .cell .meta,
  .far .cell .text {
    display: none;
  }
  .far .glyph {
    display: flex;
  }
  .mid .text {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  .near .line {
    display: block;
  }
  .far .cell[data-rel='conflicts'] {
    background: color-mix(in srgb, var(--rel-conflicts) 24%, var(--surface));
  }
  .far .cell[data-rel='context'] {
    background: color-mix(in srgb, var(--rel-context) 22%, var(--surface));
  }
  .far .cell[data-rel='supports'] {
    background: color-mix(in srgb, var(--rel-supports) 20%, var(--surface));
  }
  /* The open card: all of the chosen piece of evidence, readable at any zoom the group is shown at. */
  .cell.open,
  .far .cell.open {
    align-content: start;
    gap: 6px;
    padding: 12px 14px 8px;
    cursor: default;
  }
  .o-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 700;
    line-height: 1.3;
    color: var(--ink-strong);
  }
  .o-title {
    flex: 1;
    min-width: 0;
  }
  .o-sub {
    font-size: 12px;
    line-height: 1.3;
    color: var(--muted);
  }
  .o-heading {
    font-family: var(--font-serif);
    font-size: 16px;
    line-height: 1.28;
    color: var(--ink-strong);
  }
  .o-text {
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--ink);
  }
  .o-text.doc-text {
    font-size: 12.5px;
    line-height: 1.55;
  }
  .o-go {
    min-height: 28px;
    justify-self: start;
    font-size: 12.5px;
  }
  .measure {
    visibility: hidden;
    pointer-events: none;
    left: -10000px;
  }

  .map-frame { position:relative; min-width:0; }
  .cell.indexed { border-color:var(--selected-line); box-shadow:inset 0 0 0 1px var(--selected-line); }
  .type-tag {
    position: absolute;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px 3px 8px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--surface);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-strong);
    white-space: nowrap;
    pointer-events: none;
  }
  .type-tag .count {
    color: var(--muted);
    font-weight: 500;
  }
  /* In rows the tag sits left of its row, out of the gaps the lines cross. */
  .type-tag.side {
    transform: translate(calc(-100% - 12px), -50%);
  }
  .peek {
    position: absolute;
    z-index: 5;
    display: grid;
    gap: 4px;
    width: 288px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--surface);
    box-shadow: var(--shadow-float);
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--ink);
    pointer-events: none;
  }
  .peek .where {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  .hint {
    margin: 0;
  }
  @media (max-width: 699px) {
    .view {
      height: var(--map-h-phone, clamp(340px, 60dvh, 620px));
    }
    .styles,
    .fit-label {
      display: none;
    }
    /* One row of controls, the relations in a row of their own that scrolls sideways. */
    .rels {
      order: 3;
      flex: 1 0 100%;
      min-width: 0;
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .rels .chip {
      flex-shrink: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cell,
    .edges path {
      transition: none;
    }
  }
</style>
