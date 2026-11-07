import { beforeNavigate } from '$app/navigation';

/** Register during component setup; reuse the confirmation for local dismissals. */
export function guardUnsavedChanges(dirty: () => boolean, message: () => string) {
  const confirmDiscard = () => !dirty() || window.confirm(message());
  beforeNavigate((navigation) => {
    if (!dirty()) return;
    // Reloading/closing the tab needs the browser's own before-unload prompt.
    if (navigation.type === 'leave' || !confirmDiscard()) navigation.cancel();
  });
  return confirmDiscard;
}
