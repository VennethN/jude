import { expect, test, type Locator } from '@playwright/test';

const rect = (surface: Locator) => surface.evaluate((node) => {
  const b = node.getBoundingClientRect();
  return [b.x, b.y, b.width, b.height].map(Math.round);
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`case search and source inspection preserve focus at ${width}px`, async ({ page }) => {
    const phone = width === 390;
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: phone ? 'reduce' : 'no-preference' });
    await page.goto('/demo/documents/d1?p=d1p4');
    await page.waitForLoadState('networkidle');
    const trigger = page.getByRole('button', { name: 'Cari dalam perkara' });
    await trigger.click();
    const search = page.getByRole('dialog', { name: 'Cari dalam berkas perkara' });
    const field = search.getByRole('combobox');
    await expect(field).toBeFocused();
    await expect(search).toContainText('Ketik minimal dua huruf');
    await expect(search.getByRole('option')).toHaveCount(0);
    await expect.poll(() => rect(search)).toEqual(phone ? [0, 24, 390, 820] : [400, 120, 640, 194]);
    const motion = await search.evaluate((n) => getComputedStyle(n).animationName);
    if (phone) expect(motion).toBe('none');
    else expect(motion).toContain('palette-in');
    await field.fill('g');
    await expect(search.getByRole('option')).toHaveCount(0);
    await field.fill('gerbang');
    await expect(search.getByRole('option').first()).toBeVisible();
    const first = await field.getAttribute('aria-activedescendant');
    await field.press('ArrowDown');
    await expect(field).not.toHaveAttribute('aria-activedescendant', first!);
    await expect(field).toBeFocused();
    await field.fill('zzzz-no-such-record');
    await expect(search).toContainText('Tidak ada yang cocok');
    await field.press('Escape');
    await expect(search).toHaveCount(0);
    await expect(trigger).toBeFocused();

    const mark = page.locator('button.margin-mark[data-pid="d1p4"]');
    await mark.click();
    const inspector = page.getByRole('dialog', { name: 'Kutipan berkas' });
    const close = inspector.getByRole('button', { name: 'Tutup' });
    await expect(close).toBeFocused();
    await expect.poll(() => rect(inspector)).toEqual(phone ? [0, 10, 390, 834] : [880, 0, 560, 900]);
    await expect(inspector).toContainText('sedikit setelah pukul 20.00 WIB');
    if (phone) expect(await inspector.evaluate(n => n.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
    await close.press('Escape');
    await expect(inspector).toHaveCount(0);
    await expect(mark).toBeFocused();

    await trigger.click();
    await field.fill('Pemeriksaan saksi Rina');
    const destination = await search.getByRole('option').first().getAttribute('href');
    await field.press('Enter');
    await expect(page).toHaveURL(new RegExp(destination!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
    await expect(search).toHaveCount(0);
  });
}

test('phone sheets follow the finger and dismiss only after a full pull', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    const touch = await context.newCDPSession(page);
    await page.goto('/demo/documents/d1?p=d1p4');
    await page.waitForLoadState('networkidle');
    const sheets = [
      { trigger: page.getByRole('button', { name: 'Cari dalam perkara' }), title: 'Cari dalam berkas perkara' },
      { trigger: page.locator('button.margin-mark[data-pid="d1p4"]'), title: 'Kutipan berkas' },
    ];
    for (const { trigger, title } of sheets) {
      await trigger.tap();
      const sheet = page.getByRole('dialog', { name: title });
      await expect(sheet).toBeVisible();
      const handle = sheet.locator('.grabber');
      await expect(handle).toBeVisible();
      const initial = await rect(sheet);
      for (const [distance, end] of [[80, 'touchCancel'], [70, 'touchEnd'], [145, 'touchEnd']] as const) {
        await test.step(`${title}: ${distance}px pull, ${end}`, async () => {
          const box = await handle.boundingBox();
          expect(box).not.toBeNull();
          const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
          try {
            await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
            await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance, id: 1 }] });
            await expect.poll(() => rect(sheet)).toEqual([initial[0], initial[1] + distance, ...initial.slice(2)]);
          } finally {
            // Release even when an assertion fails so cleanup cannot mask that failure.
            await touch.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] });
          }
          if (distance < 120) await expect.poll(() => rect(sheet)).toEqual(initial);
        });
      }
      await expect(sheet).toHaveCount(0);
    }
  } finally { await context.close(); }
});
