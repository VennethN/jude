import { expect, test } from '@playwright/test';

test('a reader can dismiss the introduction and prepare the next hearing from the overview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  const invite = page.getByRole('region', { name: 'Lihat cara kerja Jude' });
  await invite.getByRole('button', { name: 'Tidak sekarang' }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.reload();
  await expect(invite).toHaveCount(0);

  const overview = page.url();
  const prepare = page.getByRole('button', { name: 'Siapkan pertanyaan', exact: true });
  await prepare.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await prepare.click();
  const panel = page.getByRole('dialog', { name: 'Asisten perkara' });
  const question = panel.locator('.message.question .answer').filter({
    hasText: 'Pertanyaan apa yang perlu saya siapkan untuk sidang berikutnya?',
  });
  await expect(question).toHaveCount(1);
  await expect(panel.locator('[data-tour="assistant-answer"]')).toBeVisible();
  await expect(page).toHaveURL(overview);
  await panel.getByRole('button', { name: 'Tutup asisten' }).click();
  await expect(panel).toHaveCount(0);
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(4);
  await page.getByRole('button', { name: 'Buka asisten perkara', exact: true }).click();
  await expect(question).toHaveCount(1);
});
