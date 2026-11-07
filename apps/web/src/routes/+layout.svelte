<script lang="ts">
  import '../app.css';
  import { browser } from '$app/environment';
  import { onNavigate } from '$app/navigation';

  let { data, children } = $props();
  let transitioning = false;
  $effect(() => { if (browser) document.documentElement.lang = data.lang; });

  onNavigate((navigation) => {
    const from = navigation.from?.url, to = navigation.to?.url;
    if (!from || !to || navigation.willUnload || transitioning ||
        !document.startViewTransition || document.visibilityState !== 'visible' ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const changeView = from.pathname !== to.pathname ||
      ['view', 'tab'].some(key => from.searchParams.get(key) !== to.searchParams.get(key));
    if (!changeView) return;

    return new Promise<void>((proceed) => {
      transitioning = true;
      const transition = document.startViewTransition(async () => {
        proceed();
        await navigation.complete;
      });
      transition.ready.catch(() => {});
      transition.finished.catch(() => {}).finally(() => { transitioning = false; });
    });
  });
</script>

{@render children()}
