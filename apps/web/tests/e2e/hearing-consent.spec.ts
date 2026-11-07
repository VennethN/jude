import { expect, test } from '@playwright/test';

for (const { lang, width } of [{ lang: 'id', width: 390 }, { lang: 'en', width: 1440 }]) {
  test(`recording consent excludes closed hearings at ${width}px in ${lang}`, async ({ page, context, baseURL }, info) => {
    const en = lang === 'en';
    await context.addCookies([{ name: 'jude_lang', value: lang, url: baseURL! }]);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/demo/hearings');
    const caseId = new URL(page.url()).pathname.split('/')[2];
    const ended = await page.request.post(`/api/cases/${caseId}/hearings/h3/end`, {
      headers: { origin: new URL(page.url()).origin }, data: {},
    });
    expect(ended.ok(), await ended.text()).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: en ? 'New hearing' : 'Sidang baru', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: en ? /Record live/ : /Rekam langsung/ }).click();
    await form.getByRole('textbox', { name: en ? 'Hearing title' : 'Judul sidang' }).fill('Pemeriksaan dengan izin');
    const closed = form.getByRole('checkbox', { name: en ? 'Closed hearing' : 'Sidang tertutup', exact: true });
    const permitted = form.getByRole('checkbox', { name: en ? /The presiding judge/ : /Hakim ketua/ });
    const start = form.getByRole('button', { name: en ? 'Start hearing' : 'Mulai sidang', exact: true });
    await expect(closed).not.toBeChecked();
    await expect(permitted).not.toBeChecked();
    await expect(start).toBeDisabled();

    await permitted.check();
    await expect(start).toBeEnabled();
    await closed.check();
    await expect(permitted).not.toBeChecked();
    await expect(start).toBeDisabled();
    await expect(form.getByRole('status')).toHaveText(en
      ? 'Recording is unavailable for closed hearings.' : 'Perekaman tidak tersedia untuk sidang tertutup.');
    await page.screenshot({ path: info.outputPath('closed-hearing.png') });

    // Clearing the closed status must not silently restore a prior permission confirmation.
    await closed.uncheck();
    await expect(permitted).not.toBeChecked();
    await expect(start).toBeDisabled();
    await closed.check();
    await permitted.focus();
    await permitted.press('Space');
    await expect(closed).not.toBeChecked();
    await expect(permitted).toBeChecked();
    await expect(form.getByRole('status')).toHaveCount(0);
    await expect(start).toBeEnabled();
    await permitted.uncheck();
    await expect(start).toBeDisabled();
    await permitted.check();
    await page.screenshot({ path: info.outputPath('permitted-hearing.png') });
    const submitted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith(`/api/cases/${caseId}/hearings`));
    await start.click();
    expect((await submitted).postDataJSON()).toMatchObject({ flow: 'live', recordingPermission: true, closed: false });
    await expect(page).toHaveURL(new RegExp(`/case/${caseId}/hearings/[^/]+$`));
  });
}
