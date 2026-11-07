import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('jump from a hearing finding to the exact line and retain a bookmark and speaker assignment', async ({
  page
}) => {
  await page.goto('/demo/hearings/h2?f=f1');
  await expect(page.locator('#line-s208')).toHaveClass(/chosen/);
  await expect(page.getByRole('complementary', { name: 'Lihat sekilas' })).toContainText('20.00 WIB');
  await page.getByRole('button', { name: 'Tutup tampilan sekilas' }).click();
  await page.locator('#line-s208 .flag').click();
  await expect(page.locator('#line-s208 .flag')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#line-s208 .name').click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Nama pembicara').fill('Rina Hartati · saksi keamanan');
  await editor.getByRole('button', { name: 'Simpan suara' }).click();
  await expect(page.locator('#line-s206 .name')).toHaveText('Rina Hartati · saksi keamanan');
  await page.getByRole('button', { name: 'Tampilkan pernyataan ditandai saja' }).click();
  await expect(page.locator('#line-s208')).toBeVisible();
  await expect(page.locator('#line-s206')).toHaveCount(0);
  await page.goto('/demo/hearings/h2?s=s208');
  await expect(page.locator('#line-s208')).toHaveClass(/chosen/);
  await expect(page.locator('#line-s208 .flag')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('audio')).toHaveCount(0);
  await page.keyboard.press('f');
  await page.getByRole('searchbox', { name: 'Cari kata atau pembicara' }).fill('setengah sepuluh');
  await expect(page.locator('.words mark').first()).toHaveText(/setengah sepuluh/i);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: 'Cari kata atau pembicara' })).toHaveCount(0);
});

test('replay on a phone without a microphone and start a scheduled example after ending it', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => {
        throw new Error('UNEXPECTED_MICROPHONE_REQUEST');
      }
    });
  });
  await page.goto('/demo/hearings/h3');
  await expect(page.locator('[data-sid="replay-h3-0"]')).toContainText('kunci Gudang B', { timeout: 12000 });
  await page.getByRole('button', { name: 'Jeda', exact: true }).click();
  await expect(page.getByText('Putar ulang dijeda')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hubungkan mikrofon' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Akhiri sidang' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Akhiri dan tinjau' }).click();
  await expect(page.getByText('Transkrip contoh · tanpa rekaman audio')).toBeVisible();
  await page.goto('/demo/hearings/h4');
  await page.getByRole('button', { name: 'Mulai sidang' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByRole('button', { name: 'Mulai sidang' })).toBeDisabled();
  await form.getByRole('checkbox', { name: /Hakim ketua/ }).check();
  await form.getByRole('button', { name: 'Mulai sidang' }).click();
  await expect(page.locator('[data-sid="replay-h4-0"]')).toBeVisible({ timeout: 12000 });
  await page.getByRole('button', { name: /Giliran Anda/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Tanggapan Anda');
  await expect(page.getByRole('dialog').getByRole('link').first()).toHaveAttribute('href', /\/findings\//);
});

test('an imported transcript stays searchable with an accessible time index', async ({ page }) => {
  await page.goto('/demo/hearings/h1');
  await expect(page.getByText('Teks dari risalah yang diimpor')).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(0);
  const slider = page.getByRole('slider', { name: 'Geser linimasa transkrip' });
  await expect(slider).toBeEnabled();
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '00:00:10');
  await page.getByRole('button', { name: 'Cari transkrip' }).click();
  await page.getByRole('searchbox', { name: 'Cari kata atau pembicara' }).fill('sehat');
  await expect(page.locator('.words mark').first()).toHaveText(/sehat/i);
});

test('an imported recording seeks to linked testimony and plays only when requested', async ({ page }) => {
  await page.goto('/demo');
  // Five seconds of silent mono PCM and one synthetic witness line, in a portable case archive.
  const archive = await readFile(new URL('./fixtures/hearing-playback.jude', import.meta.url));
  const restored = await page.request.post('/api/cases/import', {
    headers: { origin: new URL(page.url()).origin },
    multipart: { file: { name: 'hearing-playback.jude', mimeType: 'application/zip', buffer: archive } }
  });
  expect(restored.ok(), await restored.text()).toBeTruthy();
  const { id } = await restored.json();
  const workspace = await (await page.request.get('/api/cases/' + id + '/workspace')).json();
  const hearing = workspace.hearings[0];
  const line = workspace.statements[0];
  await page.goto('/case/' + id + '/hearings/' + hearing.id + '?s=' + line.id);
  const audio = page.locator('audio');
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).readyState))
    .toBeGreaterThan(0);
  expect(await audio.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true);
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime))
    .toBeCloseTo(2, 1);
  await page.getByRole('button', { name: 'Putar dari 00:00:02' }).click();
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime))
    .toBeGreaterThan(2);
});
