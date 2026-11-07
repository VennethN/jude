import { expect, test } from '@playwright/test';

test('the map index preserves full source names and works independently of canvas zoom', async ({ page }) => {
  await page.goto('/demo/connections');
  const index = page.getByRole('group', { name: 'Indeks bukti' });
  const hearings = index.locator('[data-kind="hearing"] .index-entry');
  const docs = index.locator('[data-kind="document"] .index-entry');
  const names = ['BAP Saksi Rina Hartati', 'BAP Saksi Dimas Prasetyo', 'Laporan Log Akses Gerbang & CCTV'];
  for (const [i,name] of names.entries()) await expect(docs.nth(i)).toHaveText(name);
  await expect(hearings.nth(2)).toHaveAccessibleDescription(/Langsung/);

  for (const width of [1440,390]) {
    await page.setViewportSize({ width, height:width === 390 ? 844 : 900 });
    const box = await index.boundingBox();
    expect(box!.width).toBeLessThan(width);
    await hearings.first().focus();
    await hearings.first().press('ArrowRight');
    await expect(hearings.nth(1)).toBeFocused();
    await hearings.nth(1).press('Enter');
    await expect(hearings.nth(1)).toHaveAttribute('aria-current','location');
    for (const step of ['Perbesar','Perkecil','Tampilkan semua'])
      await page.getByRole('button',{name:step,exact:true}).click();
    await expect(hearings.nth(1)).not.toHaveAttribute('aria-current','location');
    await hearings.nth(1).focus();
    await hearings.nth(1).press('End');
    await expect(docs.last()).toBeFocused();
    const allFit = await index.locator('.index-entry').evaluateAll(elements => elements.every(el =>
      el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis'));
    expect(allFit).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await docs.first().focus();
  await docs.first().press('Enter');
  await expect(page).toHaveURL(/of=document%3Ad1/);
  await expect(page.locator('.group-panel')).toBeVisible();
});
