<script lang="ts">
  import { onMount } from 'svelte';
  import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
  import type { Lang } from '@jude/core/domain';

  let {
    url,
    pageNo,
    zoom,
    lang,
    highlight = '',
    ready
  }: {
    url: string;
    pageNo: number;
    zoom: number;
    lang: Lang;
    highlight?: string;
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
  let focusRange = $derived.by(() => {
    const phrase = highlight.toLocaleLowerCase().trim();
    const text = spans
      .map((s) => s.text)
      .join(' ')
      .toLocaleLowerCase();
    const start = phrase ? text.indexOf(phrase) : -1;
    return [start, start + phrase.length];
  });

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
        const span = { text: item.str, left: x, top: y - h * 0.85, w: item.width * scale, h, start: index };
        index += item.str.length + 1;
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
    <div class="text-layer">
      {#each spans as span}
        <span
          class:lit={focusRange[0] >= 0 &&
            span.start < focusRange[1] &&
            span.start + span.text.length > focusRange[0]}
          style:left={span.left + 'px'}
          style:top={span.top + 'px'}
          style:width={span.w + 'px'}
          style:height={span.h + 'px'}
          style:font-size={span.h + 'px'}>{span.text}</span
        >
      {/each}
    </div>
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
    color: #191714;
    margin-inline: auto;
  }
  .sheet.failed {
    display: none;
  }
  canvas {
    display: block;
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
    background: rgba(226, 165, 67, 0.34);
  }
  .text-layer span::selection {
    background: rgba(92, 133, 162, 0.4);
    color: transparent;
  }
</style>
