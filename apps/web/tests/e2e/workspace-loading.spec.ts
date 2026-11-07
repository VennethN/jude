import { expect, test, type Page } from '@playwright/test';

async function holdData(page: Page, path: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/' + path + '/__data.json*', async (route) => {
    await gate;
    await route.continue();
  }, { times: 1 });
  return release;
}

async function openRegister(page: Page) {
  await page.goto('/demo/hearings');
  const caseBase = new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
  // A fresh register has no copy of this case in its tab cache.
  await page.goto('/cases');
  await expect(page.locator('#case-register')).toBeVisible();
  return caseBase;
}

async function savedRecord(page: Page, href: string) {
  await page.locator('#case-register').evaluate((register, url) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'Saved record';
    item.append(link);
    register.append(item);
  }, href);
  return page.getByRole('link', { name: 'Saved record' });
}

const records = [
  { library: 'hearings', record: 'h2', view: 'hearing', heading: /Rina Hartati/, width: 1440, height: 900 },
  { library: 'documents', record: 'd1', view: 'document', heading: /Rina Hartati/, width: 390, height: 844 },
] as const;

for (const record of records) {
  test('a delayed ' + record.view + ' preserves the shell until its record arrives', async ({ page }) => {
    await page.setViewportSize({ width: record.width, height: record.height });
    const base = await openRegister(page);
    const link = await savedRecord(page, base + '/' + record.library + '/' + record.record);
    const outgoing = page.locator('#case-register');
    const release = await holdData(page, record.library + '/' + record.record);
    try {
      await link.focus();
      await page.keyboard.press('Enter');
      const preview = page.locator('[data-loading-view="' + record.view + '"]');
      await expect(preview).toBeInViewport();
      await expect(page.getByRole('status').filter({ hasText: /Memuat/ })).toBeVisible();
      await expect(page.locator('#case-main [aria-busy="true"]')).toHaveCount(1);
      await expect(outgoing).toBeAttached();
      await expect(outgoing).toBeHidden();
      await expect(page.locator('.topbar')).toBeInViewport();
      expect(await preview.locator('.geometry').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(record.width);
    } finally {
      release();
    }
    await expect(page.getByRole('heading', { level: 1, name: record.heading })).toBeVisible();
    await expect(page.locator('[data-loading-view]')).toHaveCount(0);
  });
}

test('replacing a pending navigation restores the filtered register without a late page swap', async ({ page }) => {
  await page.goto('/demo/hearings');
  const search = page.getByRole('searchbox', { name: 'Cari sidang' });
  await search.fill('Rina');
  const release = await holdData(page, 'cases');
  try {
    await page.locator('#workspace-rail .switch-case').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-loading-view="cases"]')).toBeVisible();
    await page.locator('#workspace-rail a[href$="/hearings"]').click();
    await expect(search).toBeVisible();
    await expect(search).toHaveValue('Rina');
  } finally {
    release();
  }
  await expect(page.locator('.library-row')).toHaveCount(1);
  await expect(page).toHaveURL(/\/hearings$/);
  await expect(page.locator('[data-loading-view]')).toHaveCount(0);
});

test('a warm hearing opens without painting a placeholder', async ({ page }) => {
  await page.goto('/demo/hearings');
  const link = page.locator('.library-row h3 a[href$="/h2"]');
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: /Rina Hartati/ })).toBeVisible();
  await page.goBack();
  await expect(link).toBeVisible();
  const observation = await page.evaluateHandle(() => {
    const counter = { appeared: false };
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('[data-loading-view]') || node.querySelector('[data-loading-view]'))) {
          counter.appeared = true;
        }
      }
    }).observe(document.querySelector('#case-main')!, { childList: true, subtree: true });
    return counter;
  });
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: /Rina Hartati/ })).toBeVisible();
  expect(await observation.evaluate((counter) => counter.appeared)).toBe(false);
});

test('an unavailable saved record replaces the loading state with the real error', async ({ page }) => {
  const base = await openRegister(page);
  const link = await savedRecord(page, base + '/hearings/unavailable-record');
  const release = await holdData(page, 'hearings/unavailable-record');
  try {
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-loading-view="hearing"]')).toBeInViewport();
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: 'Catatan ini tidak ditemukan.' })).toBeVisible();
  await expect(page.locator('[data-loading-view]')).toHaveCount(0);
});
