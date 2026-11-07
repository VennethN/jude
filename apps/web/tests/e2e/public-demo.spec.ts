import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('the public example acknowledges a slow request, retries and resumes its original case', async ({ page }) => {
  await page.goto('/');
  const enter = page.locator('.cover a[href="/demo"]');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  await page.route('**/demo', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts++;
    if (attempts > 1) return route.continue();
    await pending;
    await route.fulfill({ status: 503, body: '' });
  });

  await enter.click();
  const status = page.getByRole('status').filter({ hasText: /Membuka perkara contoh/ });
  await expect(status).toBeVisible();
  await expect(enter).toHaveAttribute('aria-busy', 'true');
  await enter.click();
  expect(attempts).toBe(1);
  release();

  const retry = page.getByRole('button', { name: 'Coba lagi' });
  await expect(retry).toBeVisible();
  await expect(enter).not.toHaveAttribute('aria-busy', 'true');
  await retry.click();
  await expect(page).toHaveURL(/\/case\/[\w-]+$/);
  await expect(page.locator('.overview h1')).toBeVisible();
  const original = new URL(page.url()).pathname;
  await page.goto('/');
  await enter.click();
  await expect(page).toHaveURL(url => url.pathname === original);
  expect(attempts).toBe(3);

  const deep = await page.request.get('/demo/documents/d1?p=d1p4', { maxRedirects: 0 });
  expect(deep.status()).toBe(303);
  expect(deep.headers().location).toBe(original + '/documents/d1?p=d1p4');
});

test('entering the example while signed in preserves the private account and case register', async ({ page, baseURL }) => {
  const signup = await page.request.post('/api/auth/signup', {
    headers: { origin: baseURL! },
    data: { email: randomUUID() + '@example.test', name: 'Advokat Contoh', password: randomUUID() },
  });
  expect(signup.ok()).toBe(true);
  const account = await signup.json();
  await page.goto('/');
  await page.locator('.cover a[href="/demo"]').click();
  await expect(page).toHaveURL(/\/cases$/);
  const session = await (await page.request.get('/api/me')).json();
  expect(session.user.id).toBe(account.user.id);
  expect(session.user.guest).toBe(false);
  const library = await (await page.request.get('/api/cases')).json();
  expect(library.cases).toEqual([]);
});

test('the example remains available when JavaScript is disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('.cover a[href="/demo"]').click();
    await expect(page).toHaveURL(/\/case\/[\w-]+$/);
    await expect(page.locator('.overview h1')).toBeVisible();
  } finally {
    await context.close();
  }
});
