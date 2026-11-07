import { expect, test } from '@playwright/test';

for (const motion of ['no-preference', 'reduce'] as const) {
  test('workspace navigation respects the ' + motion + ' motion preference', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.addInitScript(() => {
      if (!document.startViewTransition) return;
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        const transition = start(...args);
        transition.ready.then(() => {
          document.documentElement.dataset.routeFade = getComputedStyle(
            document.documentElement, '::view-transition-new(root)'
          ).animationDuration;
        }).catch(() => {});
        return transition;
      };
    });
    await page.goto('/demo');
    const rail = page.getByRole('navigation', { name: 'Bagian perkara' });
    await rail.getByRole('link', { name: 'Dokumen' }).click();
    await expect(page.getByRole('heading', { name: 'Dokumen', exact: true })).toBeVisible();
    const root = page.locator('html');
    if (motion === 'reduce') {
      await expect(root).not.toHaveAttribute('data-route-fade', /.+/);
    } else {
      await expect(root).toHaveAttribute('data-route-fade', '0.22s');
    }
    await page.getByRole('button', { name: 'Menu ruang kerja' }).click();
    const action = page.getByRole('button', { name: 'Preferensi', exact: true });
    await expect(action).toBeVisible();
    const duration = await action.evaluate(n => parseFloat(getComputedStyle(n).transitionDuration));
    if (motion === 'reduce') expect(duration).toBeLessThan(.01);
    else expect(duration).toBeCloseTo(.17, 2);
    await action.click();
    await expect(page.getByRole('dialog', { name: 'Preferensi' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
