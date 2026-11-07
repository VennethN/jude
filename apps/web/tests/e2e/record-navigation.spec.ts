import { expect, test } from '@playwright/test';

test('a filed document opens its cited findings and clears its filter', async ({ page }) => {
  await page.goto('/demo/documents');
  const file = page.locator('.files li').filter({ has: page.getByRole('link', { name: 'BAP Saksi Rina Hartati', exact: true }) });
  await expect(file).toContainText(/\d+ kutipan/);
  await file.getByRole('link', {name: /dirujuk temuan/}).click();
  await expect(page).toHaveURL(/\/findings\?doc=d1/);
  await expect(page.locator('.queue .ev-pick').first()).toBeVisible();
  await page.getByRole('link', { name: 'Hapus filter dokumen' }).click();
  expect(new URL(page.url()).searchParams.has('doc')).toBe(false);
});

test('the phone finding sheet follows a filtered queue and returns to its record', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/demo/findings');
  await page.locator('.queue .ev-pick').first().click();
  const sheet = page.getByRole('dialog', {name:'Temuan',exact:true});
  const before = await sheet.locator('[data-tour="finding-detail"] > h2').textContent();
  const box = await sheet.boundingBox();
  expect(box?.width).toBe(390);
  expect(box?.height).toBe(834);
  await expect(sheet.getByRole('button',{name:'Temuan sebelumnya'})).toBeDisabled();
  await sheet.getByRole('button',{name:'Temuan berikutnya'}).click();
  await expect(sheet.locator('[data-tour="finding-detail"] > h2')).not.toHaveText(before!);
  await expect(sheet.getByRole('navigation',{name:'Urutan temuan'})).toContainText(/2 dari/);
  await sheet.getByRole('button',{name:'Tutup',exact:true}).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.queue .ev-pick').first()).toBeVisible();
});
