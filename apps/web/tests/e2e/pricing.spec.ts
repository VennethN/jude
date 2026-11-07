import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('compare all four plans, return from contact and follow a trial link', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/pricing');
  await expect(page.locator('.always li')).toHaveCount(4);
  await expect(page.locator('.plans-grid article')).toHaveCount(4);
  await expect(page.locator('.plans-grid .quotas li')).toHaveCount(16);
  await page.getByRole('link', { name: 'Bandingkan semua paket' }).click();
  await expect(page).toHaveURL(/#pr-compare$/);
  const table = page.getByRole('table');
  await expect(table.locator('tr')).toHaveCount(27);
  await expect(table.locator('tbody')).toHaveCount(4);
  await expect(table.getByRole('row', { name: /Jam sidang ditranskripsi per bulan/ })).toContainText('15');
  const negotiated = table
    .getByRole('row', { name: /SSO dan log audit/ })
    .getByRole('cell')
    .last();
  await expect(negotiated).toHaveText('Sesuai kontrak');
  const consult = table.getByRole('link', { name: 'Bahas paket Mitra' });
  await consult.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(consult).toBeFocused();
  await expect(page.locator('#pr-faq summary')).toHaveCount(6);
  await page.getByText('Apakah Jude bisa dipakai dalam bahasa Inggris?', { exact: true }).click();
  await expect(page.locator('#pr-faq details[open]')).toContainText('bahasa sumbernya');
  await expect(page.locator('.closing a[href="/demo"]')).toHaveText('Coba perkara contoh');
  await page.locator('.closing a[href*="/signup"]').click();
  await expect(page).toHaveURL(/\/signup\?plan=pro&cycle=yearly$/);
});

test('phone comparison scrolls within its page and the language switch keeps the billing cycle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pricing?cycle=monthly#pr-compare');
  const table = page.getByRole('region', { name: 'Perbandingan paket' });
  const moreColumns = await table.evaluate((el) => {
    el.scrollTo({ left: el.scrollWidth });
    return el.scrollLeft;
  });
  expect(moreColumns).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('footer a[href="/#lp-source"]')).toBeVisible();
  await page
    .locator('footer')
    .getByRole('button', { name: /English/ })
    .click();
  await expect(page).toHaveURL(/\/pricing\?cycle=monthly/);
  await expect(page.locator('#plan-pro')).toContainText('Rp349,000');
  await expect(page.locator('.closing h2')).toContainText('Your next hearing,');
});

test('signed-in subscribers manage their current plan and can ask about Partner', async ({ page }) => {
  const response = await page.request.post('/api/auth/signup', {
    data: {
      name: 'Pricing Test',
      email: randomUUID() + '@example.test',
      password: 'Example-Trial-9146',
      planId: 'pro',
      cycle: 'yearly',
    },
  });
  expect(response.ok()).toBe(true);
  const before = await (await page.request.get('/api/billing')).json();
  await page.goto('/pricing?cycle=monthly');
  await expect(page.locator('#plan-pro').getByRole('link', { name: 'Kelola paket' })).toHaveAttribute(
    'href',
    '/billing?plan=pro&cycle=monthly',
  );
  const contact = page.locator('#plan-partner').getByRole('link', { name: 'Hubungi tim' });
  await contact.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  const after = await (await page.request.get('/api/billing')).json();
  expect(after.planId).toBe('pro');
  expect(after.trialEndsAt).toEqual(before.trialEndsAt);
  expect(after.cycle).toEqual(before.cycle);
});
