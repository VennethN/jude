import { expect, test, type Page } from '@playwright/test';

const transcript = (name: string, text = 'Keterangan dari berkas ini.') => ({
  name, mimeType: 'text/plain', buffer: Buffer.from(`[00:00:00] Saksi: ${text}`),
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

async function confirm(page: Page, action: () => Promise<unknown>, discard = false) {
  const handled = deferred();
  let message = '';
  page.once('dialog', async dialog => {
    message = dialog.message();
    if (discard) await dialog.accept(); else await dialog.dismiss();
    handled.resolve();
  });
  await action();
  await handled.promise;
  return message;
}

test('a failed replacement clears the old transcript and cannot import it', async ({ page }) => {
  await page.goto('/demo/hearings?new=import');
  const form = page.getByRole('dialog');
  const input = form.locator('input[type=file]');
  const turn = form.getByRole('textbox', { name: 'Keterangan 1', exact: true });
  await input.setInputFiles(transcript('first.txt', 'Teks pertama.'));
  await expect(turn).toHaveValue('Teks pertama.');
  await input.setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') });
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(turn).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Konfirmasi dan impor' })).toBeDisabled();

  await input.setInputFiles(transcript('replacement.txt', 'Keterangan dari berkas pengganti.'));
  await expect(turn).toHaveValue('Keterangan dari berkas pengganti.');
  await expect(form.getByRole('alert')).toHaveCount(0);
  await form.getByRole('button', { name: 'Konfirmasi dan impor' }).click();
  await expect(page).toHaveURL(/\/hearings\/[^/]+$/);
  await expect(page.locator('.words')).toContainText(['Keterangan dari berkas pengganti.']);
});

test('a superseded or abandoned preview cannot repopulate the import form', async ({ page }) => {
  await page.goto('/demo/hearings?new=import');
  const form = page.getByRole('dialog');
  const input = form.locator('input[type=file]');
  const received = deferred(), release = deferred(), finished = deferred();
  let calls = 0;
  await page.route('**/hearings/import/preview', async route => {
    const response = await route.fetch();
    if (++calls === 1) {
      received.resolve();
      await release.promise;
      await route.fulfill({ response }).catch(() => {}); // The browser may already have aborted it.
      finished.resolve();
    } else await route.fulfill({ response });
  });
  await input.setInputFiles(transcript('slow.txt', 'Teks lama yang terlambat.'));
  await received.promise;
  await input.setInputFiles(transcript('current.txt', 'Teks terbaru.'));
  const turn = form.getByRole('textbox', { name: 'Keterangan 1', exact: true });
  await expect(turn).toHaveValue('Teks terbaru.');
  release.resolve();
  await finished.promise;
  await expect(turn).toHaveValue('Teks terbaru.');
  await expect(form.getByRole('button', { name: 'Konfirmasi dan impor' })).toBeEnabled();

  const abandoned = deferred(), resume = deferred(), settled = deferred();
  await page.unroute('**/hearings/import/preview');
  await page.route('**/hearings/import/preview', async route => {
    const response = await route.fetch();
    abandoned.resolve();
    await resume.promise;
    await route.fulfill({ response }).catch(() => {});
    settled.resolve();
  });
  await input.setInputFiles(transcript('abandoned.txt'));
  await abandoned.promise;
  await form.getByRole('button', { name: 'Kembali', exact: true }).click();
  await form.getByRole('button', { name: /Impor transkrip/ }).click();
  resume.resolve();
  await settled.promise;
  await expect(turn).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Konfirmasi dan impor' })).toBeDisabled();
});

for (const destination of ['documents', 'new-dialog']) {
test(`a hearing saved after dismissal leaves ${destination} alone`, async ({ page }) => {
  await page.goto('/demo/hearings?new=schedule');
  const base = new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
  const received = deferred(), release = deferred();
  let savedId = '';
  await page.route('**/api/cases/*/hearings', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    savedId = (await response.json()).id;
    received.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  const form = page.getByRole('dialog');
  await form.getByRole('textbox', { name: 'Judul sidang' }).fill('Sidang yang sedang disimpan');
  await form.getByRole('button', { name: 'Jadwalkan sidang', exact: true }).click();
  await received.promise;
  await form.getByRole('button', { name: 'Tutup', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(base + '/hearings');
  if (destination === 'documents') {
    await page.locator(`a.section-link[href="${base}/documents"]`).click();
    await expect(page).toHaveURL(base + '/documents');
  } else {
    await page.getByRole('button', { name: 'Sidang baru', exact: true }).click();
    await form.getByRole('button', { name: /Jadwalkan sidang/ }).click();
    await form.getByRole('textbox', { name: 'Judul sidang' }).fill('Sidang berikutnya');
  }
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/hearings'));
  release.resolve();
  await (await response).finished();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(base + (destination === 'documents' ? '/documents' : '/hearings'));
  if (destination === 'new-dialog') {
    await expect(form.getByRole('textbox', { name: 'Judul sidang' })).toHaveValue('Sidang berikutnya');
    await form.getByRole('button', { name: 'Tutup', exact: true }).click();
  }
  // Dismissing the UI does not cancel a save already accepted by the server.
  await page.goto(base + '/hearings/' + savedId);
  await expect(page.getByRole('heading', { name: 'Sidang yang sedang disimpan' })).toBeVisible();
});
}

for (const { lang, width } of [{ lang: 'id', width: 390 }, { lang: 'en', width: 1440 }]) {
  test(`transcript corrections survive cancelled dismissal at ${width}px in ${lang}`, async ({ page, context, baseURL }, info) => {
    const en = lang === 'en';
    await context.addCookies([{ name: 'jude_lang', value: lang, url: baseURL! }]);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/demo/hearings?new=import');
    const form = page.getByRole('dialog');
    const input = form.locator('input[type=file]');
    await input.setInputFiles(transcript('draft.txt'));
    const turn = form.getByRole('textbox', { name: en ? 'Testimony 1' : 'Keterangan 1', exact: true });
    await turn.fill('Keterangan yang telah dikoreksi.');
    const expectedPrompt = en ? /transcript edits have not been imported/ : /Perubahan transkrip belum diimpor/;
    expect(await confirm(page, () => page.keyboard.press('Escape'))).toMatch(expectedPrompt);
    await expect(turn).toHaveValue('Keterangan yang telah dikoreksi.');
    expect(await confirm(page, () => page.mouse.click(1, 1))).toMatch(expectedPrompt);
    await expect(turn).toHaveValue('Keterangan yang telah dikoreksi.');
    expect(await confirm(page, () => form.getByRole('button', { name: en ? 'Back' : 'Kembali', exact: true }).click())).toMatch(expectedPrompt);
    await expect(turn).toHaveValue('Keterangan yang telah dikoreksi.');
    expect(await confirm(page, () => input.setInputFiles(transcript('unwanted.txt')))).toMatch(expectedPrompt);
    await expect(input).toHaveValue(/draft\.txt$/);
    await expect(turn).toHaveValue('Keterangan yang telah dikoreksi.');
    await page.screenshot({ path: info.outputPath('retained-transcript.png') });
    // Saving the correction must not prompt to discard it or navigate twice.
    const unexpected: string[] = [];
    page.on('dialog', async dialog => { unexpected.push(dialog.message()); await dialog.dismiss(); });
    await form.getByRole('button', { name: en ? 'Confirm and import' : 'Konfirmasi dan impor' }).click();
    await expect(page).toHaveURL(/\/hearings\/[^/]+$/);
    await expect(page.locator('.words')).toContainText(['Keterangan yang telah dikoreksi.']);
    expect(unexpected).toEqual([]);
  });
}

test('discarding transcript corrections closes the form with a single confirmation', async ({ page }) => {
  await page.goto('/demo/hearings?new=import');
  const form = page.getByRole('dialog');
  await form.locator('input[type=file]').setInputFiles(transcript('discard.txt'));
  await form.getByRole('textbox', { name: 'Keterangan 1', exact: true }).fill('Perubahan yang dibuang.');
  expect(await confirm(page, () => form.getByRole('button', { name: 'Tutup', exact: true }).click(), true)).toContain('Perubahan transkrip');
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(/\/hearings$/);
});
