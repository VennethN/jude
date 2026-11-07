import { expect, test, type Page } from '@playwright/test';

async function move(page: Page, y: number) {
  await page.evaluate(async (top) => {
    scrollTo({ top, behavior: 'instant' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, y);
}

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`the floating section navigation follows scroll direction at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width > 760 ? 'no-preference' : 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const nav = page.locator('nav.localnav');
    const coverEnd = await page.locator('.lp .cover').evaluate((node) => node.getBoundingClientRect().bottom + scrollY);
    await expect(nav).toHaveJSProperty('inert', true);
    await move(page, coverEnd + 220);
    await expect(nav).toHaveJSProperty('inert', true);
    await move(page, coverEnd + 215);
    await expect(nav).toHaveJSProperty('inert', true);
    await move(page, coverEnd + 202);
    await expect(nav).toHaveJSProperty('inert', false);
    const geometry = () => nav.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map(Math.round);
    });
    await expect.poll(geometry).toEqual(width > 760 ? [190, 12, 1060, 56] : [8, 8, 374, 52]);
    await expect(nav.locator('a[href="/demo"]')).toBeVisible();
    const how = nav.locator('a[href="#lp-how"]');
    if (width > 760) {
      await how.click();
      await expect(page.locator('#lp-how')).toBeFocused();
      await expect(page).toHaveURL(/\/$/);
      await expect(how).toHaveAttribute('aria-current', 'location');
      await expect(nav).toHaveJSProperty('inert', true);
    } else {
      await expect(how).toBeHidden();
      await nav.getByRole('link', { name: 'Kembali ke atas' }).click();
      await expect(page.locator('.opening h1')).toBeFocused();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    }
    const closing = await page.locator('.closing').evaluate((node) => node.getBoundingClientRect().top + scrollY - innerHeight + 200);
    await move(page, closing);
    await move(page, closing - 20);
    await expect(nav).toHaveJSProperty('inert', true);
  });
}
