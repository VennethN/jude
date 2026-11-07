<script lang="ts">
  import { onMount } from 'svelte';
  import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
  import { BookOpenText } from '@lucide/svelte';
  import type { Lang } from '@jude/core/domain';

  let {
    url,
    pageNo,
    zoom,
    lang,
    highlight = '',
    annotations = [],
    select,
    ready
  }: {
    url: string;
    pageNo: number;
    zoom: number;
    lang: Lang;
    highlight?: string;
    annotations?: { id: string; text: string; loud: boolean; label: string }[];
    select: (id: string) => void;
    ready: (pages: number, text: string) => void;
  } = $props();

  let canvas: HTMLCanvasElement;
  let frame: HTMLDivElement;
  let width = $state(0);
  let documentPdf = $state.raw<PDFDocumentProxy>();
  let error = $state(false);
  let rendering = $state(false);
  let height = $state(0);
  let spans = $state<{ text: string; left: number; top: number; w: number; h: number; start: number }[]>([]);
  let searchText = $derived(
    spans
      .map((s) => s.text)
      .join(' ')
      .toLowerCase()
  );
  function rangeFor(term: string) {
    const phrase = term.toLowerCase().trim().replace(/\s+/g, ' ');
    const start = phrase ? searchText.indexOf(phrase) : -1;
    return { start, end: start + phrase.length };
  }
  let focusRange = $derived(rangeFor(highlight));
  let indexed = $derived.by(() =>
    annotations.flatMap((annotation) => {
      const { start, end } = rangeFor(annotation.text);
      if (start < 0) return [];
      const boxes = spans
        .filter((s) => s.start < end && s.start + s.text.length > start)
        .map((s) => {
          const first = Math.max(0, start - s.start),
            last = Math.min(s.text.length, end - s.start);
          return {
            left: s.left + (s.w * first) / s.text.length,
            top: s.top,
            width: (s.w * (last - first)) / s.text.length,
            height: s.h
          };
        });
      return boxes.length ? [{ ...annotation, boxes }] : [];
    })
  );

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      width = Math.max(1, Math.floor(entry.contentRect.width));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  });

  $effect(() => {
    const source = url;
    let active = true;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    documentPdf = undefined;
    error = false;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      task = pdfjs.getDocument({ url: source, withCredentials: true });
      const pdf = await task.promise;
      if (active) documentPdf = pdf;
    })().catch(() => {
      if (active) error = true;
    });
    return () => {
      active = false;
      void task?.destroy();
    };
  });

  $effect(() => {
    const pdf = documentPdf,
      available = width,
      n = pageNo,
      z = zoom,
      callback = ready;
    if (!pdf || !available) return;
    let active = true;
    let task: RenderTask | undefined;
    let sheet: PDFPageProxy | undefined;
    rendering = true;
    error = false;
    spans = [];
    (async () => {
      sheet = await pdf.getPage(Math.min(n, pdf.numPages));
      if (!active) return;
      const scale = (Math.min(available, 850) * z) / sheet.getViewport({ scale: 1 }).width;
      const view = sheet.getViewport({ scale });
      const pixel = Math.min(window.devicePixelRatio || 1, 2);
      const offscreen = window.document.createElement('canvas');
      offscreen.width = Math.ceil(view.width * pixel);
      offscreen.height = Math.ceil(view.height * pixel);
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('canvas');
      task = sheet.render({
        canvas: offscreen,
        canvasContext: ctx,
        viewport: view,
        transform: pixel === 1 ? undefined : [pixel, 0, 0, pixel, 0, 0]
      });
      const [content] = await Promise.all([sheet.getTextContent(), task.promise]);
      if (!active) return;
      canvas.width = offscreen.width;
      canvas.height = offscreen.height;
      canvas.style.width = view.width + 'px';
      canvas.style.height = view.height + 'px';
      canvas.getContext('2d')?.drawImage(offscreen, 0, 0);
      height = view.height;
      let index = 0;
      spans = content.items.flatMap((item) => {
        if (!('str' in item) || !item.str) return [];
        const [x, y] = view.convertToViewportPoint(item.transform[4], item.transform[5]);
        const h = Math.max(1, item.height * scale);
        const clean = item.str.replace(/\s+/g, ' ').trim();
        if (!clean) return [];
        const span = { text: clean, left: x, top: y - h * 0.85, w: item.width * scale, h, start: index };
        index += clean.length + 1;
        return [span];
      });
      callback(pdf.numPages, spans.map((s) => s.text).join(' '));
      rendering = false;
    })().catch(() => {
      if (active) {
        error = true;
        rendering = false;
      }
    });
    return () => {
      active = false;
      task?.cancel();
    };
  });
</script>

<div bind:this={frame} class="frame" aria-busy={rendering}>
  {#if error}<p class="ev-notice" role="alert">
      {lang === 'id'
        ? 'Halaman PDF tidak dapat ditampilkan. Buka tampilan Teks atau unduh berkas asli.'
        : 'This PDF page could not be displayed. Open Text view or download the original.'}
    </p>{/if}
  <div class="sheet" class:failed={error} style:min-height={height ? height + 'px' : '25rem'}>
    <canvas bind:this={canvas} aria-label={(lang === 'id' ? 'Halaman ' : 'Page ') + pageNo}></canvas>
    <div class="annotation-layer" aria-hidden="true">
      {#each indexed as p (p.id)}{#each p.boxes as box}
          <span
            class:loud={p.loud}
            style:left={box.left + 'px'}
            style:top={box.top + 'px'}
            style:width={box.width + 'px'}
            style:height={box.height + 'px'}
          ></span>
        {/each}{/each}
    </div>
    <div class="text-layer">
      {#each spans as span}
        <span
          class:lit={focusRange.start >= 0 &&
            span.start < focusRange.end &&
            span.start + span.text.length > focusRange.start}
          style:left={span.left + 'px'}
          style:top={span.top + 'px'}
          style:width={span.w + 'px'}
          style:height={span.h + 'px'}
          style:font-size={span.h + 'px'}>{span.text}</span
        >
      {/each}
    </div>
    {#each indexed as p (p.id)}
      <button
        type="button"
        class="margin-mark"
        class:loud={p.loud}
        style:top={Math.max(0, p.boxes[0].top - 7) + 'px'}
        data-pid={p.id}
        aria-label={p.label}
        title={p.label}
        onclick={() => select(p.id)}><BookOpenText size={15} /></button
      >
    {/each}
  </div>
</div>

<style>
  .frame {
    overflow: auto;
    min-width: 0;
    width: 100%;
  }
  .sheet {
    position: relative;
    width: max-content;
    max-width: none;
    background: white;
    color: var(--ink);
    margin-inline: auto;
  }
  .sheet.failed {
    display: none;
  }
  canvas {
    display: block;
  }
  .annotation-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .annotation-layer span {
    position: absolute;
    background: color-mix(in srgb, var(--ev-context) 12%, transparent);
  }
  .annotation-layer span.loud {
    background: color-mix(in srgb, var(--ev-highlight) 24%, transparent);
  }
  .margin-mark {
    position: absolute;
    right: 0;
    min-width: 32px;
    min-height: 32px;
    display: grid;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }
  .margin-mark.loud {
    color: var(--accent);
  }
  @media (pointer: coarse) {
    .margin-mark {
      min-width: 44px;
      min-height: 44px;
    }
  }
  .text-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .text-layer span {
    position: absolute;
    white-space: pre;
    color: transparent;
    line-height: 1;
    cursor: text;
    overflow: hidden;
    font-family: serif;
  }
  .text-layer span.lit {
    background: color-mix(in srgb, var(--ev-highlight) 33%, transparent);
  }
  .text-layer span::selection {
    background: color-mix(in srgb, var(--ev-context) 32%, transparent);
    color: transparent;
  }
</style>
