import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('keeps a new conversation draft and selected context across reload', async ({ page }) => {
  await page.goto('/demo/assistant/new?context=document%3Ad2');
  const field = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
  await field.fill('Tolong bandingkan catatan penyerahan ini.');
  await page.getByRole('button', { name: 'Pasal.id', exact: true }).click();
  await page.reload();
  await expect(field).toHaveValue('Tolong bandingkan catatan penyerahan ini.');
  await expect(page.getByRole('button', { name: 'Pasal.id', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.composer .chip')).toHaveCount(1);
  await expect(field).toHaveAttribute('maxlength', '6000');
  await field.fill('x'.repeat(6000));
  await expect(page.locator('.length-hint')).toHaveText('6.000 / 6.000 karakter');
});

test('keeps the dock draft after closing and reopening', async ({ page }) => {
  await page.goto('/demo/documents');
  const open = page.getByRole('button', { name: 'Buka asisten perkara' });
  await open.click();
  const field = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
  await field.fill('Draf untuk memeriksa sumber.');
  await page.getByRole('button', { name: 'Tutup asisten' }).click();
  await open.click();
  await expect(field).toHaveValue('Draf untuk memeriksa sumber.');
});

test('stops a pending request and restores its draft, including after reload', async ({ page }) => {
  await page.goto('/demo/assistant/new');
  let received!: () => void;
  const started = new Promise<void>(resolve => { received = resolve; });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/threads/*/messages', async route => {
    received(); await waiting;
    await route.abort().catch(() => {});
  });
  const field = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
  await field.fill('Siapa yang memegang kunci?');
  await field.press('Enter');
  await started;
  await page.getByRole('button', { name: 'Hentikan jawaban' }).click();
  await expect(field).toHaveValue('Siapa yang memegang kunci?');
  release();
  await page.reload();
  await expect(field).toHaveValue('Siapa yang memegang kunci?');
  await expect(page.getByRole('log').locator('[data-tour="assistant-answer"]')).toHaveCount(0);
});

test('a late answer cannot return the user to the assistant after navigation', async ({ page }) => {
  await page.goto('/demo/assistant/new');
  let received!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { received = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const finished = new Promise<void>(resolve => {
    void page.route('**/threads/*/messages', async route => {
      const response = await route.fetch();
      received(); await waiting;
      await route.fulfill({ response }).catch(() => {});
      resolve();
    });
  });
  const field = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
  await field.fill('Siapa yang memegang kunci?');
  await field.press('Enter');
  await started;
  const caseBase = new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
  await page.locator('a.section-link[href="' + caseBase + '/documents"]').click();
  await expect(page).toHaveURL(new RegExp(caseBase + '/documents$'));
  release();
  await finished;
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(new RegExp(caseBase + '/documents$'));
});

test('explains request errors in the active interface language and preserves text', async ({ page }) => {
  await page.goto('/demo/assistant/new');
  await page.route('**/threads/*/messages', route => route.fulfill({ status:422,contentType:'application/json',body:JSON.stringify({error:{code:'invalid_fields',message:'Check the fields and try again.'}}) }));
  const field = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
  await field.fill('Pertanyaan saya.');
  await field.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Periksa konteks dan panjang pertanyaan');
  await expect(page.getByRole('alert')).not.toContainText('Check the fields');
  await expect(field).toHaveValue('Pertanyaan saya.');
});

test('assistant controls remain accessible on desktop and touch screens', async ({ page }, info) => {
  await page.goto('/demo/assistant/new');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 500) await page.emulateMedia({ reducedMotion:'reduce' });
    const field = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
    await field.fill('Periksa sumber ini.');
    for (const name of ['Tambah konteks','Pasal.id','Kirim pertanyaan']) {
      const box = await page.getByRole('button', { name, exact:true }).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
    expect(result.violations).toEqual([]);
    await info.attach('assistant-' + width, {body:await page.screenshot(),contentType:'image/png'});
  }
});
