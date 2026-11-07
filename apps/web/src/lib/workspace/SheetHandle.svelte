<script lang="ts">
  let { dismiss, search = false }: { dismiss: () => void; search?: boolean } = $props();
  let pointer: number | null = null;
  let panel: HTMLDialogElement | null = null;
  let startY = 0, distance = 0;
  let settling: Animation | undefined;

  function start(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    if (!event.isPrimary || event.button !== 0 || pointer !== null) return;
    panel = handle.closest('dialog');
    if (!panel) return;
    settling?.cancel();
    pointer = event.pointerId;
    startY = event.clientY;
    distance = 0;
    handle.setPointerCapture(pointer);
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointer || !panel) return;
    distance = Math.max(0, event.clientY - startY);
    panel.style.translate = '0 ' + distance + 'px';
  }
  function finish(event: PointerEvent) {
    if (event.pointerId !== pointer || !panel) return;
    const released = event.type === 'pointerup';
    const close = released && distance > 120;
    const sheet = panel;
    pointer = null;
    panel = null;
    sheet.style.removeProperty('translate');
    if (close) {
      sheet.close();
      dismiss();
    } else if (distance && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settling = sheet.animate([{ translate: '0 ' + distance + 'px' }, { translate: '0 0' }], {
        duration: 170, easing: 'cubic-bezier(.22,1,.36,1)'
      });
    }
  }
</script>

<div class="grabber" class:search aria-hidden="true" onpointerdown={start} onpointermove={move}
  onpointerup={finish} onpointercancel={finish} onlostpointercapture={finish}><span></span></div>

<style>
  .grabber { position:absolute; z-index:4; top:0; left:50%; display:grid; width:96px; height:20px; place-items:center; transform:translateX(-50%); touch-action:none; cursor:grab; }
  .grabber:active { cursor:grabbing; }
  .grabber span { width:36px; height:5px; border-radius:3px; background:color-mix(in srgb,var(--ink) 22%,transparent); }
  @media (min-width:720px) { .grabber { display:none; } }
  @media (min-width:600px) { .grabber.search { display:none; } }
</style>
