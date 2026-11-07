<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import SheetHandle from './SheetHandle.svelte';
  import { X } from '@lucide/svelte';
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  let { title, close, lang = 'id', children, headerActions, wide = false, side = false, sheet = false, docked = false }: {title:string; close:()=>void; lang?:'id'|'en'; children:Snippet; headerActions?:Snippet; wide?:boolean;side?:boolean;sheet?:boolean;docked?:boolean} = $props();
  let dialog = $state<HTMLDialogElement>();
  let opener: HTMLElement | null = null;
  let mounted = $state(false);
  const id = $props.id();
  function reveal(_node: Element, { side }: { side: boolean }): TransitionConfig {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { duration: 0 };
    const fromBottom = side && matchMedia('(max-width: 719px)').matches;
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
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mounted = true;
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus({preventScroll:true});
    };
  });
  $effect(() => {
    if (!mounted || !dialog) return;
    const modal = !docked;
    if (dialog.open && dialog.matches(':modal') === modal) return;
    if (dialog.open) dialog.close();
    if (modal) dialog.showModal();
    else dialog.show();
  });
</script>
<dialog class:wide class:side class:sheet class:docked bind:this={dialog} aria-modal={docked ? 'false' : 'true'} transition:reveal|global={{ side: side || sheet }} aria-labelledby={id} oncancel={(e)=>{e.preventDefault();close()}} onclick={(e)=>{if(dialog && e.target===dialog && !docked){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}}}>
  {#if side}<h2 id={id} class="sr-only">{title}</h2>
  {:else}
    <div class="dialog-head">
      {#if sheet}<SheetHandle dismiss={close}/>{/if}
      <h2 id={id}>{title}</h2>
      {#if headerActions}<div class="head-actions">{@render headerActions()}</div>{/if}
      <button class="icon-button" aria-label={lang === 'id' ? 'Tutup' : 'Close'} onclick={close}><X size={19}/></button>
    </div>
  {/if}
  {@render children()}
</dialog>
<style>
 dialog{width:min(490px,calc(100% - 28px));max-height:85dvh;overflow:auto;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);padding:26px}
 dialog.wide{width:min(710px,calc(100% - 28px))}dialog::backdrop{background:rgb(12 25 20 / .52)}.dialog-head{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:22px}.dialog-head h2{font-size:2.1rem}.dialog-head .icon-button{border:0;background:transparent}
 dialog.sheet { max-width:100%; width:min(560px,100%); height:100dvh; max-height:100dvh; margin:0 0 0 auto; padding:0; border-radius:14px 0 0 14px; overscroll-behavior:contain; }
 dialog.side { max-width:100%; width:min(440px,100%); height:100dvh; max-height:100dvh; padding:0; margin:0 0 0 auto; border-radius:14px 0 0 14px; overscroll-behavior:contain; }
 dialog.side.docked { position:fixed; z-index:20; inset:0 0 0 auto; width:404px; border:0; border-inline-start:1px solid var(--line); border-radius:0; }
 .sheet .dialog-head { align-items:center; position:sticky; top:0; z-index:2; margin:0; padding:10px 16px; background:var(--surface); border-bottom:1px solid var(--line); }
 .head-actions { display:flex; align-items:center; margin-inline-start:auto; }
 .sheet .dialog-head h2 { font:600 14px/1.4 var(--sans); letter-spacing:0; }
 @media (max-width:719px) { .sheet .dialog-head { padding-top:18px; } dialog.sheet,dialog.side { width:100%; height:calc(100dvh - 10px); max-height:calc(100dvh - 10px); margin:auto 0 0; padding-bottom:env(safe-area-inset-bottom,0px); border-radius:18px 18px 0 0; } }
</style>
