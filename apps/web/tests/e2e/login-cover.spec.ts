import { expect, test } from '@playwright/test';

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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
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
