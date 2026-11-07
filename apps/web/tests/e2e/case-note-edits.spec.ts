import { expect, test } from '@playwright/test';

for (const { lang, width } of [{ lang: 'id', width: 1440 }, { lang: 'en', width: 390 }]) {
  test(`unsaved review notes protect navigation and sheet dismissal at ${width}px in ${lang}`, async ({ page, context, baseURL }, info) => {
    const en = lang === 'en';
    await context.addCookies([{ name: 'jude_lang', value: lang, url: baseURL! }]);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/demo/findings/f1');
    const initialURL = page.url();
    const base = new URL(initialURL).pathname.split('/').slice(0, 3).join('/');
    await page.getByRole('button', { name: en ? 'Add a note' : 'Tambah catatan', exact: true }).click();
    const note = page.getByRole('textbox', { name: en ? 'Review note' : 'Catatan pemeriksaan' });
    await note.fill('Catatan yang belum selesai.');
    const prompts: string[] = [];
    page.on('dialog', async dialog => { prompts.push(dialog.message()); await dialog.dismiss(); });
    if (width < 760) await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    else await page.locator(`a.section-link[href="${base}/documents"]`).click();
    await expect.poll(() => prompts.length).toBe(1);
    expect(prompts[0]).toContain(en ? 'review note has not been saved' : 'Catatan pemeriksaan belum disimpan');
    await expect(page).toHaveURL(initialURL);
    await expect(note).toHaveValue('Catatan yang belum selesai.');
    await page.screenshot({ path: info.outputPath('retained-review-note.png') });
    await page.getByRole('button', { name: en ? 'Save note' : 'Simpan catatan' }).click();
    await expect(page.getByText(en ? 'Changes saved.' : 'Perubahan tersimpan.', { exact: true })).toBeVisible();
    if (width < 760) await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator(`a[href="${base}/documents"]:visible`).first().click();
    await expect(page).toHaveURL(base + '/documents');
    expect(prompts).toHaveLength(1);
    await page.goto(initialURL);
    await expect(note).toHaveValue('Catatan yang belum selesai.');
  });
}

test('review notes warn on reload and can be explicitly discarded on navigation', async ({ page }) => {
  await page.goto('/demo/findings/f1');
  const base = new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
  await page.getByRole('button', { name: 'Tambah catatan', exact: true }).click();
  const note = page.getByRole('textbox', { name: 'Catatan pemeriksaan' });
  await note.fill('Catatan sementara.');
  const prompt = page.waitForEvent('dialog');
  const reload = page.evaluate(() => window.location.reload());
  const dialog = await prompt;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(note).toHaveValue('Catatan sementara.');
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`a.section-link[href="${base}/documents"]`).click();
  await expect(page).toHaveURL(base + '/documents');
  await page.goBack();
  await expect(page).toHaveURL(/\/findings\/f1$/);
  await page.getByRole('button', { name: 'Tambah catatan', exact: true }).click();
  await expect(note).toHaveValue('');
});
