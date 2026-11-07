import { expect, test } from '@playwright/test';

test('case shortcuts respect focus, chords and modal ownership', async ({ page }) => {
  await page.goto('/demo');
  await page.waitForLoadState('networkidle');
  const base = new URL(page.url()).pathname;
  const rail = page.getByRole('navigation', { name: 'Bagian perkara' });
  await expect(rail.getByRole('link', { name: 'Temuan' })).toHaveAccessibleDescription(/\d+ perlu diperiksa/);
  await expect(rail.getByRole('link', { name: 'Dokumen' })).toHaveAccessibleDescription(/\d+ dokumen/);
  await expect(rail.getByRole('link', { name: 'Sidang' })).toHaveAccessibleDescription(/berlangsung/);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Cari dalam berkas perkara' });
  const query = search.getByRole('combobox');
  await expect(query).toBeFocused();
  await query.pressSequentially('g f / a');
  await expect(query).toHaveValue('g f / a');
  await expect(page).toHaveURL(new RegExp(base + '$'));
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);

  await page.getByRole('button', { name: 'Menu ruang kerja' }).click();
  await page.getByRole('button', { name: 'Pintasan keyboard' }).click();
  const guide = page.getByRole('dialog', { name: 'Pintasan keyboard' });
  await expect(guide).toContainText('Keterkaitan');
  await page.keyboard.press('Meta+k');
  await expect(guide).toBeVisible();
  await expect(search).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(guide).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('#case-main').focus();
  await page.keyboard.press('g');
  await page.waitForTimeout(1250);
  await page.keyboard.press('f');
  await expect(page).toHaveURL(new RegExp(base + '$'));
  for (const [key, path] of [
    ['h', '/hearings'],
    ['d', '/documents'],
    ['f', '/findings'],
    ['c', '/connections'],
    ['o', ''],
  ]) {
    await page.locator('#case-main').focus();
    await page.keyboard.press('g');
    await page.keyboard.press(key);
    await expect(page).toHaveURL(new RegExp(base + path + '$'));
  }
  await page.keyboard.press('a');
  const assistant = page.getByRole('dialog', { name: 'Asisten perkara' });
  await expect(assistant).toBeVisible();
  await expect(assistant).toHaveAttribute('aria-modal', 'false');
  const dock = await assistant.boundingBox();
  expect(dock?.width).toBe(404);
  expect(dock?.x).toBe(1036);
  await page.locator('#case-main').focus();
  await expect(page.locator('#case-main')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#case-main').focus();
  await page.keyboard.press('/');
  await expect(query).toBeFocused();
});

test('creation announces the new route once and leaves browser history clean', async ({ page }) => {
  await page.goto('/demo');
  await page.locator('.switch-case').click();
  await page.getByRole('button', { name: 'Perkara baru', exact: true }).first().click();
  await page.getByRole('button', { name: /Mulai perkara kosong/ }).click();
  await page.getByRole('textbox', { name: 'Judul perkara' }).fill('Pemeriksaan notifikasi');
  await page.getByRole('button', { name: 'Buat perkara', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pemeriksaan notifikasi' })).toBeVisible();
  const notices = page.locator('.shell-feedback');
  await expect(notices).toHaveText('Perkara dibuat.');
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(history.state).includes('judeNotice')))
    .toBe(false);
  await page
    .getByRole('navigation', { name: 'Bagian perkara' })
    .getByRole('link', { name: 'Dokumen' })
    .click();
  await expect(page.getByRole('heading', { name: 'Dokumen', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Pemeriksaan notifikasi' })).toBeVisible();
  await expect(notices).toBeEmpty();
});

test('case actions open from a nested section and dismiss with Escape', async ({ page }) => {
  await page.goto('/demo');
  const rail = page.getByRole('navigation', { name: 'Bagian perkara' });
  await rail.getByRole('link', { name: 'Dokumen' }).click();
  await expect(page.getByRole('heading', { name: 'Dokumen', exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu ruang kerja' });
  await menu.click();
  await page.getByRole('button', { name: 'Tindakan perkara' }).click();
  const actions = page.getByRole('dialog', { name: 'Menu perkara' });
  await expect(actions.getByRole('link', { name: 'Ekspor arsip .jude' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Pengaturan perkara' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(actions).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test('the overview invitation starts its first tour step and keeps keyboard ownership', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Mulai tur' }).click();
  const tour = page.locator('.tour-strip');
  await expect(tour).toHaveAttribute('data-step','file');
  await expect(page.locator('.tour-stage .spot')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(tour).toHaveAttribute('data-step','hearing');
  await expect(page).toHaveURL(/\/hearings\/h3$/);
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
});

test.describe('coarse-pointer navigation', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('phone tabs and narrow-tablet rail expose their destination and state', async ({ page }) => {
    await page.goto('/demo');
    const tabs = page.getByRole('navigation', { name: 'Navigasi perkara' });
    await expect(tabs.getByRole('link')).toHaveCount(5);
    await expect(tabs.getByRole('link', { name: 'Temuan' })).toHaveAccessibleDescription(/perlu diperiksa/);
    const targets = await tabs
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((a) => [a.getBoundingClientRect().width, a.getBoundingClientRect().height]),
      );
    expect(targets.every(([width, height]) => width >= 44 && height >= 44)).toBe(true);
    await page.getByRole('button', { name: 'Menu ruang kerja' }).tap();
    await expect(page.getByRole('button', { name: 'Pintasan keyboard' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Preferensi', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: 'Preferensi' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Tutup' }).tap();
    await tabs.getByRole('link', { name: 'Dokumen' }).tap();
    await expect(tabs.getByRole('link', { name: 'Dokumen' })).toHaveAttribute('aria-current', 'page');
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(tabs).toBeHidden();
    const rail = page.getByRole('navigation', { name: 'Bagian perkara' });
    await expect(rail.getByText('Keterkaitan', { exact: true })).toBeVisible();
    await rail.getByRole('link', { name: 'Keterkaitan' }).tap();
    await expect(rail.getByRole('link', { name: 'Keterkaitan' })).toHaveAttribute('aria-current', 'page');
    const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(horizontal).toBe(false);
  });
});
