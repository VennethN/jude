import { expect, test } from '@playwright/test';

test('billing shows account-backed quotas and saves the selected demo plan and cycle', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/demo');
  await page.goto('/billing');
  const api = async () => (await page.request.get('/api/billing')).json();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Paket & tagihan');
  await expect(page.locator('.meters li')).toHaveCount(6);
  const current = await api();
  const quota = current.usage.boards;
  await expect(page.locator('.meters li').first().locator('.meter-head strong')).toHaveText(String(quota.used ?? quota));
  await page.getByRole('link',{name:'Tahunan',exact:true}).click();
  const firm=page.locator('#plan-firm');
  await firm.getByRole('button',{name:'Pilih Firma'}).click();
  await expect(page.getByRole('region',{name:'Paket Anda'})).toContainText('Firma');
  await expect.poll(async()=> (await api()).cycle).toBe('yearly');
  await page.reload();
  await expect(page.getByRole('region',{name:'Paket Anda'})).toContainText('Firma');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
