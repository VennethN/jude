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
  const partial = page.locator('[data-partial-id="replay-h4-0"]');
  await expect(partial).toBeVisible({timeout:10000});
  await expect(partial.locator('.name')).toHaveText('Hakim Ketua');
  await partial.evaluate(node => node.setAttribute('data-preserved-test', 'first-speaker'));
  const early = await partial.locator('.words').textContent();
  await expect.poll(() => partial.locator('.words').textContent()).not.toBe(early);
  await page.getByRole('button',{name:'Jeda',exact:true}).click();
  const paused = await partial.locator('.words').textContent();
  await page.waitForTimeout(450);
  await expect(partial.locator('.words')).toHaveText(paused!);
  await expect(partial).not.toHaveClass(/speaking/);
  await expect(partial.locator('.caret')).toHaveCSS('animation-name','none');
  await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
  const finalized = page.locator('[data-sid="replay-h4-0"]');
  await expect(finalized).toBeVisible({timeout:12000});
  await expect(finalized).toHaveAttribute('data-preserved-test','first-speaker');
  await expect(partial).toHaveCount(0);
  await expect(finalized.locator('.when')).toHaveText('00:00:06');
  await expect(page.locator('[data-partial-id="replay-h4-1"] .name')).toHaveText(/Penasihat Hukum|Kuasa Hukum/,{timeout:6000});
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

test('the hearing player keeps time across speeds and findings return to their source statement', async ({ page }) => {
  await page.goto('/demo/hearings/h2');
  const player = page.locator('.player');
  await expect(player).toContainText('Transkrip contoh · tanpa rekaman audio');
  await expect(page.locator('audio')).toHaveCount(0);
  const width = await player.evaluate(element => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(900);
  const slider = player.getByRole('slider');
  await player.getByRole('button', { name: 'Maju 10 detik' }).click();
  await expect(slider).toHaveAttribute('aria-valuetext','00:00:10');
  await player.getByRole('combobox', { name: 'Kecepatan putar' }).selectOption('2');
  await player.getByRole('button', { name: 'Putar', exact:true }).click();
  await expect.poll(() => slider.inputValue()).not.toBe('10');
  await player.getByRole('button', { name: 'Jeda', exact:true }).click();
  const frozen = await slider.inputValue();
  await page.waitForTimeout(350);
  await expect(slider).toHaveValue(frozen);
  const finding = page.locator('.finding-index a[href$="/f1"]');
  await finding.click();
  const quick = page.getByRole('complementary',{name:'Lihat sekilas'});
  await expect(quick).toBeVisible();
  await quick.getByRole('link',{name:'Detail di Temuan'}).click();
  await expect(page).toHaveURL(/\/findings\/f1/);
  await page.goBack();
  await expect(quick).toBeVisible();
  await expect(page).toHaveURL(/[?&]s=s208/);
  await expect(page.locator('#line-s208')).toHaveClass(/chosen/);
});

test('the phone intake can file a real appointment and filters the library by testimony', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/demo/hearings');
  await page.getByRole('searchbox',{name:'Cari sidang'}).fill('setengah sepuluh');
  await expect(page.locator('.library-row')).toHaveCount(1);
  await expect(page.locator('.match-line')).toHaveAttribute('href', /hearings\/h2\?s=/);
  await page.getByRole('button',{name:'Sidang baru'}).click();
  const intake = page.getByRole('dialog');
  await expect(intake.getByRole('button',{name:/Unggah audio/})).toBeDisabled();
  const box = await intake.boundingBox();
  expect(box?.width).toBe(390);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(844,0);
  await intake.getByRole('button',{name:/Jadwalkan sidang/}).click();
  await intake.getByRole('textbox',{name:'Judul sidang'}).fill('Pemeriksaan tambahan');
  await intake.getByLabel('Tanggal',{exact:true}).fill('2030-11-14');
  await intake.getByLabel('Waktu (WIB)').fill('11:45');
  await intake.getByRole('button',{name:'Jadwalkan sidang'}).click();
  await expect(page.getByRole('heading',{name:/Pemeriksaan tambahan/})).toBeVisible();
  await expect(page.getByText('Sidang ini belum dimulai.')).toBeVisible();
  await expect(page.getByText(/11:45 WIB/)).toBeVisible();
});
