import { expect, test } from '@playwright/test';

test('the assistant can include or omit sample legal discovery independently of case citations', async ({
  page,
}) => {
  await page.goto('/demo/assistant/new');
  await page.waitForLoadState('networkidle');
  const ask = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
  const toggle = page.getByRole('button', { name: 'Pasal.id', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await ask.fill('Apa rujukan Pasal 185 KUHAP tentang keterangan saksi?');
  await ask.press('Enter');
  const answers = page.getByRole('log').locator('[data-tour="assistant-answer"]');
  await expect(answers).toHaveCount(1);
  const law = answers.first().locator('details').filter({ hasText: 'Rujukan hukum' });
  await expect(law).toHaveCount(1);
  await expect(law).not.toHaveAttribute('open', '');
  await law.locator('summary').click();
  await law.getByRole('button', { name: /Pasal 185/ }).click();
  const inspector = page.getByRole('dialog', { name: 'Rujukan hukum' });
  await expect(inspector).toContainText('Metadata contoh Pasal.id');
  await inspector.getByRole('button', { name: 'Tutup', exact: true }).click();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await ask.fill('Bandingkan keterangan saksi menurut Pasal 185 KUHAP.');
  await ask.press('Enter');
  await expect(answers).toHaveCount(2);
  await expect(answers.last().locator('details').filter({ hasText: 'Rujukan hukum' })).toHaveCount(0);
  await expect(answers.last().locator('[data-tour="assistant-citations"]')).not.toHaveAttribute('open', '');
});
