import { expect, test } from '@playwright/test';

test('sign-in is the first hero action for visitors and demo guests on desktop and mobile', async ({ page, baseURL }, info) => {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const first = page.locator('.opening .actions a').first();
    await expect(first).toHaveAccessibleName('Masuk');
    await expect(first).toHaveAttribute('href', '/login');
    await expect(first).toBeInViewport();
    await expect(page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Masuk' })).toBeInViewport();
    if (width !== 320) await page.screenshot({ path: info.outputPath('landing-entry-' + width + '.png') });
  }
  expect((await page.request.post('/api/auth/demo', { headers: { origin: baseURL! } })).ok()).toBe(true);
  await page.context().addCookies([{ name: 'jude_lang', value: 'en', url: baseURL! }]);
  await page.goto('/');
  const hero = page.locator('.opening');
  await expect(hero.getByRole('link', { name: 'Try the example case' })).toHaveAttribute('href', '/demo');
  await hero.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});

test('the sign-in cover keeps credentials, recovery and the return route accessible', async ({ page }) => {
  await page.goto('/login?next=%2Fbilling');
  const main = page.getByRole('main');
  const email = main.getByLabel('Email', { exact: true });
  const password = main.locator('input[name="password"]');
  await expect(email).toHaveAttribute('autocomplete', 'email');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');

  for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await expect(main.getByRole('heading', { level: 1 })).toBeInViewport();
    await expect(main.getByRole('button', { name: 'Masuk', exact: true })).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }

  await page.getByLabel('Menu', { exact: true }).click();
  await page.locator('.mobile-links').getByRole('button', { name: /English/ }).click();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Sign in to your workspace.');
  await expect(main.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup?next=%2Fbilling');
  await email.fill('unregistered-login@example.test');
  await password.fill('unregistered-sign-in');
  await password.press('Enter');
  await expect(main.getByRole('alert')).toContainText('The email and password do not match.');
  await expect(email).toHaveValue('unregistered-login@example.test');
  await main.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Reset your password.');
});

test('registration shares the illustrated sign-in cover and keeps the chosen plan and return link', async ({ page }, info) => {
  await page.goto('/login?next=%2Fbilling&plan=pro');
  const main = page.getByRole('main');
  await main.getByRole('link', { name: 'Buat akun', exact: true }).click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fbilling&plan=pro/);
  await expect(main.getByRole('heading', { level: 1 })).toHaveText('Buat akun.');
  await expect(main.getByLabel('Nama lengkap')).toHaveAttribute('autocomplete', 'name');
  await expect(main.locator('input[name=password]')).toHaveAttribute('autocomplete', 'new-password');
  await expect(main.locator('.login-leaf')).toContainText('Uji coba 14 hari');
  await expect(main.getByRole('link', { name: 'Masuk', exact: true })).toHaveAttribute('href', '/login?next=%2Fbilling&plan=pro');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 1000 ? 900 : 844 });
    await expect(main.locator('.folder')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Buat akun', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width !== 320) await page.screenshot({ path: info.outputPath('signup-' + width + '.png') });
  }
});
