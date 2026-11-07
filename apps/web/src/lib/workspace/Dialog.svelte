<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  let { title, close, lang = 'id', children, wide = false, side = false, sheet = false }: {title:string; close:()=>void; lang?:'id'|'en'; children:Snippet; wide?:boolean;side?:boolean;sheet?:boolean} = $props();
  let dialog:HTMLDialogElement;
  const id = $props.id();
  function reveal(_node: Element, { side }: { side: boolean }): TransitionConfig {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };
    const fromBottom = side && matchMedia('(max-width: 620px)').matches;
    return {
      duration: side ? 260 : 170,
      easing: cubicOut,
      css: (t, u) => {
        const shift = side
          ? 'translate' + (fromBottom ? 'Y' : 'X') + '(' + (u * 28) + 'px)'
          : 'translateY(' + (u * 5) + 'px) scale(' + (1 - u * .015) + ')';
        return 'opacity:' + t + ';transform:' + shift;
      },
    };
  }
  onMount(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); before?.focus({preventScroll:true}); };
  });
</script>
<dialog class:wide class:side class:sheet bind:this={dialog} transition:reveal|global={{ side: side || sheet }} aria-labelledby={id} oncancel={(e)=>{e.preventDefault();close()}} onclick={(e)=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}}}>
  <div class="dialog-head" class:sr-only={side}><h2 id={id}>{title}</h2><button class="icon-button" tabindex={side?-1:0} aria-label={lang==='id'?'Tutup':'Close'} onclick={close}><X size={19}/></button></div>
  {@render children()}
</dialog>
<style>
 dialog{width:min(490px,calc(100% - 28px));max-height:85dvh;overflow:auto;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);padding:26px}
 dialog.wide{width:min(710px,calc(100% - 28px))}dialog::backdrop{background:rgb(12 25 20 / .52)}.dialog-head{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:22px}.dialog-head h2{font-size:2.1rem}.dialog-head .icon-button{border:0;background:transparent}
 dialog.side{margin:0 0 0 auto;width:min(490px,100%);height:100dvh;max-height:none;border-radius:12px 0 0 12px;padding:20px}.side .dialog-head{margin:0}@media(max-width:620px){dialog.side{margin:auto 0 0;width:100%;height:min(86dvh,760px);border-radius:14px 14px 0 0}}

 dialog.sheet { max-width:100%; width:min(560px,100%); height:100dvh; max-height:100dvh; margin:0 0 0 auto; padding:0; border-radius:14px 0 0 14px; overscroll-behavior:contain; }
 .sheet .dialog-head { align-items:center; position:sticky; top:0; z-index:2; margin:0; padding:10px 16px; background:var(--surface); border-bottom:1px solid var(--line); }
 .sheet .dialog-head h2 { font-size:1.5rem; }
 @media (max-width:719px) { dialog.sheet { width:100%; height:calc(100dvh - 10px); max-height:calc(100dvh - 10px); margin:auto 0 0; padding-bottom:env(safe-area-inset-bottom,0px); border-radius:18px 18px 0 0; } }
</style>
