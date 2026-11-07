<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  let { title, close, lang = 'id', children, wide = false, side = false }: {title:string; close:()=>void; lang?:'id'|'en'; children:Snippet; wide?:boolean;side?:boolean} = $props();
  let dialog:HTMLDialogElement;
  const id = $props.id();
  onMount(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); before?.focus({preventScroll:true}); };
  });
</script>
<dialog class:wide class:side bind:this={dialog} aria-labelledby={id} oncancel={(e)=>{e.preventDefault();close()}} onclick={(e)=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}}}>
  <div class="dialog-head" class:sr-only={side}><h2 id={id}>{title}</h2><button class="icon-button" tabindex={side?-1:0} aria-label={lang==='id'?'Tutup':'Close'} onclick={close}><X size={19}/></button></div>
  {@render children()}
</dialog>
<style>
 dialog{width:min(490px,calc(100% - 28px));max-height:85dvh;overflow:auto;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);padding:26px}
 dialog.wide{width:min(710px,calc(100% - 28px))}dialog::backdrop{background:rgb(12 25 20 / .52)}.dialog-head{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:22px}.dialog-head h2{font-size:2.1rem}.dialog-head .icon-button{border:0;background:transparent}
 dialog.side{margin:0 0 0 auto;width:min(490px,100%);height:100dvh;max-height:none;border-radius:12px 0 0 12px;padding:20px}.side .dialog-head{margin:0}@media(max-width:620px){dialog.side{margin:auto 0 0;width:100%;height:min(86dvh,760px);border-radius:14px 14px 0 0}}
</style>
