import { expect, test, type Page } from '@playwright/test';

async function language(page: Page, current: 'id' | 'en', next: 'id' | 'en') {
  await page.getByRole('button', { name: current === 'id' ? 'Menu ruang kerja' : 'Workspace menu', exact: true }).click();
  await page.getByRole('button', { name: current === 'id' ? 'Preferensi' : 'Preferences', exact: true }).click();
  await page.locator('#ui-language').selectOption(next);
  await expect(page.locator('html')).toHaveAttribute('lang', next);
  await page.keyboard.press('Escape');
}

for (const width of [1440, 390]) {
  test(`example labels follow the language, evidence stays Indonesian (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Tidak sekarang', exact: true }).click();
    const base = new URL(page.url()).pathname;
    const caseId = base.split('/').pop();
    const original = await (await page.request.get(`/api/cases/${caseId}/workspace`)).json();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Perkara Penggelapan Gudang Cakung');
    await language(page, 'id', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cakung Warehouse Embezzlement Case');
    await expect(page).toHaveTitle('Cakung Warehouse Embezzlement Case · Jude');
    await expect(page.locator('.facts')).toContainText('Example District Court');
    await expect(page.locator('#case-main')).toContainText('Witness Dimas Prasetyo');
    await expect(page.locator('#case-main')).toContainText('Saya supervisor Gudang B sejak tahun 2022.');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cakung Warehouse Embezzlement Case');
    await page.goto(base + '/documents/d1?p=d1p4');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rina Hartati witness statement (BAP)');
    await expect(page.locator('body')).toContainText('sedikit setelah pukul 20.00 WIB');
    await page.goto(base + '/hearings/h2?s=s208');
    await expect(page.locator('body')).toContainText('Witness Rina Hartati');
    await expect(page.locator('body')).toContainText('Saya sampai di gudang jam setengah sepuluh malam, Pak.');
    const after = await (await page.request.get(`/api/cases/${caseId}/workspace`)).json();
    expect(after.caseRecord).toEqual(original.caseRecord);
    expect(after.documents).toEqual(original.documents);
    expect(after.speakers).toEqual(original.speakers);
    expect(after.statements).toEqual(original.statements);
    expect(after.passages).toEqual(original.passages);
    await page.goto('/cases');
    await page.getByRole('searchbox', { name: 'Find a case' }).fill('Cakung Warehouse');
    await expect(page.getByRole('link', { name: 'Cakung Warehouse Embezzlement Case', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Cakung Warehouse Embezzlement Case', exact: true }).click();
    await language(page, 'en', 'id');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Perkara Penggelapan Gudang Cakung');
    await expect(page.locator('#case-main')).toContainText('Saksi Dimas Prasetyo');
    await expect(page.locator('#case-main')).toContainText('BAP Saksi Rina Hartati');
  });
}
