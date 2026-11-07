import { expect, test } from '@playwright/test';

test('sentencing questions use the guest case when public law discovery is unavailable or switched off', async ({
  page,
}) => {
  await page.goto('/demo/assistant/new');
  await page.waitForLoadState('networkidle');
  const ask = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
  const toggle = page.getByRole('button', { name: 'Pasal.id', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await ask.fill('Pasal apa yang memberatkan?');
  await ask.press('Enter');
  const answers = page.getByRole('log').locator('[data-tour="assistant-answer"]');
  await expect(answers).toHaveCount(1);
  const citations = answers.first().locator('[data-tour="assistant-citations"]');
  await expect(citations).toBeVisible();
  await expect(citations).not.toHaveAttribute('open', '');
  await expect(answers.first()).not.toContainText('Isu hukum apa yang ingin ditelusuri');
  await citations.locator('summary').click();
  await expect(citations.locator('.source-title').first()).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await ask.fill('Pasal apa yang memberatkan dalam kasus ini?');
  await ask.press('Enter');
  await expect(answers).toHaveCount(2);
  await expect(answers.last()).toContainText('Penelusuran hukum dinonaktifkan');
  await expect(answers.last().locator('details').filter({ hasText: 'Rujukan hukum' })).toHaveCount(0);
  await expect(answers.last().locator('[data-tour="assistant-citations"]')).not.toHaveAttribute('open', '');
});
