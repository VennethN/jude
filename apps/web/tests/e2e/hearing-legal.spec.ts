import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

test('a hearing opens a filed regulation in place and returns to its cited line', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await page.request.post('/api/auth/demo', { headers: { origin: baseURL! } });
  expect(session.ok(), await session.text()).toBe(true);
  const original = await readFile(new URL('./fixtures/hearing-playback.jude', import.meta.url));
  const files = unzipSync(original);
  const dossier = JSON.parse(strFromU8(files['case.json']));
  const sourceUrl = 'https://pasal.id/peraturan/uu/uu-no-13-tahun-2003';
  const regulation = 'UU No. 13 Tahun 2003 · Ketenagakerjaan';
  dossier.legal = [
    {
      id: 'filed-law',
      provider: 'pasal',
      sourceUrl,
      type: 'UU',
      regulation,
      article: '',
      keywords: ['ketenagakerjaan'],
      summary: {
        id: 'Identitas peraturan tercatat dalam indeks Pasal.id.',
        en: 'Pasal.id indexes this regulation.',
      },
    },
  ];
  dossier.statements[0].legal = ['filed-law'];
  files['case.json'] = strToU8(JSON.stringify(dossier));
  files['legal.json'] = strToU8(JSON.stringify(dossier.legal));
  const imported = await page.request.post('/api/cases/import', {
    headers: { origin: baseURL! },
    multipart: {
      file: { name: 'hearing-law.jude', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files)) },
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const { id } = await imported.json();
  const w = await (await page.request.get('/api/cases/' + id + '/workspace')).json();
  const hearing = w.hearings[0],
    line = w.statements[0];
  await page.goto('/case/' + id + '/hearings/' + hearing.id + '?s=' + line.id);
  await expect
    .poll(() => page.locator('audio').evaluate((node) => (node as HTMLAudioElement).currentTime))
    .toBe(2);
  const row = page.locator('[data-sid="' + line.id + '"]');
  const chip = row.getByRole('button', { name: regulation });
  await expect(chip).toBeVisible();
  await chip.click();
  const source = page.getByRole('dialog', { name: 'Rujukan hukum' });
  await expect(source.getByRole('heading', { name: regulation })).toBeVisible();
  await expect(source.getByRole('link', { name: 'Buka sumber di Pasal.id' })).toHaveAttribute(
    'href',
    sourceUrl,
  );
  await page.keyboard.press('Escape');
  await expect(source).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(row).toHaveClass(/chosen/);
});
