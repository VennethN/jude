import { expect, test, type Page } from '@playwright/test';

const card = (page: Page) => page.locator('.tour-strip[data-ready="true"]');
async function verifySpotlight(page: Page) {
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.feedback')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const overlay = document.querySelector('.tour-stage:popover-open');
        const popover = overlay?.querySelector<HTMLElement>('.tour-strip[data-ready="true"]');
        const spot = overlay?.querySelector('.spot')?.getBoundingClientRect();
        if (!popover || !spot || !popover.dataset.target) return false;
        const b = popover.getBoundingClientRect();
        const inView = b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1;
        const overlap = (a: DOMRect, r: DOMRect) =>
          Math.max(0, Math.min(a.right, r.right) - Math.max(a.left, r.left)) *
          Math.max(0, Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top));
        const onTarget = [...document.querySelectorAll(popover.dataset.target)].some(
          (t) => overlap(spot, t.getBoundingClientRect()) > 12
        );
        return (
          inView && onTarget && overlap(spot, b) < 2 && document.documentElement.scrollWidth === innerWidth
        );
      })
    )
    .toBe(true);
}

test('a phone tour follows a hearing to the finding sheet and its exact source, then resumes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Mulai tur' }).click();
  const expected = ['file', 'hearing', 'compare', 'decide', 'source', 'composer', 'sections'];
  for (const [i, id] of expected.entries()) {
    await expect(card(page)).toHaveAttribute('data-step', id);
    await verifySpotlight(page);
    if (id === 'compare') await expect(page.locator('dialog[open] .tour-stage:popover-open')).toBeVisible();
    if (id === 'source') {
      await expect(page.locator('[data-tour="source-passage"]')).toHaveAttribute('data-pid', 'd1p4');
      await page.keyboard.press('Escape');
      await expect(card(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Menu ruang kerja' }).click();
      await page.getByRole('button', { name: 'Panduan perkara' }).click();
      await page.getByRole('button', { name: /Mengenal perkara.*Lanjut dari langkah/ }).click();
      await expect(card(page)).toHaveAttribute('data-step', id);
      await verifySpotlight(page);
    }
    await card(page)
      .getByRole('button', { name: i === expected.length - 1 ? 'Selesai' : 'Lanjut', exact: true })
      .click();
  }
  await expect(page.getByRole('dialog', { name: 'Panduan perkara' })).toBeVisible();
  const session = await (await page.request.get('/api/me')).json();
  expect(session.prefs.toursDone).toContain('overview');
});

test('an empty personal register tours actual controls and a new case tours its own empty hearing library', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 820, height: 725 });
  const headers = { origin: baseURL! };
  const signup = await page.request.post('/api/auth/signup', {
    headers,
    data: {
      name: 'Guide Reader',
      email: 'tour-' + crypto.randomUUID() + '@example.test',
      password: 'Working-Paper-731!',
      lang: 'en',
    },
  });
  expect(signup.ok()).toBe(true);
  await page.goto('/cases');
  await page.getByRole('button', { name: /Start the tour|Mulai tur/ }).click();
  for (const id of ['register', 'create', 'search']) {
    await expect(card(page)).toHaveAttribute('data-step', id);
    await verifySpotlight(page);
    await card(page)
      .getByRole('button', { name: id === 'search' ? /Finish|Selesai/ : /Next|Lanjut/, exact: true })
      .click();
  }
  const created = await page.request.post('/api/cases', {
    headers,
    data: { title: 'Hearing guidance', reference: 'COURT/1', type: 'pidana' },
  });
  expect(created.ok()).toBe(true);
  const record = await created.json();
  await page.goto('/case/' + record.id);
  await page.getByRole('button', { name: /Workspace menu|Menu ruang kerja/ }).click();
  await page.getByRole('button', { name: /Guided tours|Panduan perkara/ }).click();
  await page.getByRole('button', { name: /Follow a hearing|Mengikuti sidang/ }).click();
  await expect(card(page)).toHaveAttribute('data-step', 'new-hearing');
  await verifySpotlight(page);
  await card(page)
    .getByRole('button', { name: /Next|Lanjut/ })
    .click();
  await expect(card(page)).toHaveAttribute('data-step', 'register');
  await verifySpotlight(page);
  await expect(page).toHaveURL(new RegExp('/case/' + record.id + '/hearings$'));
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
});
