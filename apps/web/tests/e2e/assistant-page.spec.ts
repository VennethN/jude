import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Workspace } from '@jude/core/domain';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const workspace = async (
  page: Page,
  caseId = new URL(page.url()).pathname.split('/')[2],
): Promise<Workspace> => {
  const response = await page.request.get('/api/cases/' + caseId + '/workspace');
  expect(response.ok()).toBeTruthy();
  return response.json();
};

async function checkComposer(page: Page, field: Locator) {
  await expect(field).toBeInViewport({ ratio: 1 });
  expect(
    await field.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === node;
    }),
  ).toBe(true);
  const send = page.getByRole('button', { name: /^(Kirim pertanyaan|Send question)$/ });
  await expect(send).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const [width, height] of [
  [1440, 900],
  [390, 844],
  [320, 750],
]) {
  const phone = width < 500;
  test.describe('assistant at ' + width + 'px', () => {
    test.use({ viewport: { width, height }, isMobile: phone, hasTouch: phone });

    test('filters history by cited document and returns from the original to the conversation', async ({
      page,
    }, info) => {
      await page.goto('/demo/assistant');
      const w = await workspace(page);
      const sample = w.threads.find((t) => t.id === 'th-keys')!;
      const title = typeof sample.title === 'string' ? sample.title : sample.title.id;
      const passage = w.passages.find((p) => p.id === 'd2p2')!;
      const doc = w.documents.find((d) => d.id === passage.docId)!;
      const rail = page.getByRole('complementary', { name: 'Riwayat percakapan' });
      const filter = rail.getByRole('group').getByRole('button', { name: doc.title, exact: true });
      const threads = rail.locator('a.thread');
      await expect(threads).toHaveCount(w.threads.length);
      await filter.click();
      await expect(filter).toHaveAttribute('aria-pressed', 'true');
      await expect(threads).toHaveCount(1);
      await expect(threads).toContainText(title);
      const search = rail.getByRole('searchbox');
      await search.fill('patroli');
      await expect(threads).toHaveCount(0);
      await search.fill('');
      if (phone) await threads.tap();
      else await threads.click();
      await expect(page).toHaveURL(new RegExp('/assistant/' + sample.id + '$'));
      await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
      if (phone) await expect(rail).toBeHidden();
      else await expect(rail.locator('[aria-current="page"]')).toContainText(title);

      const log = page.getByRole('log');
      const question = log.locator('.message.question');
      const answer = log.locator('[data-tour="assistant-answer"]');
      await expect(question.locator('.answer')).toHaveText(title);
      await expect(question.getByRole('link', { name: 'Seluruh perkara' })).toHaveAttribute(
        'href',
        '/case/' + w.caseRecord.id,
      );
      const position = await log.evaluate((node) => {
        const row = node.querySelector('.log')!.getBoundingClientRect();
        const bubble = node.querySelector('.question')!.getBoundingClientRect();
        return { right: Math.abs(row.right - bubble.right), left: bubble.left - row.left };
      });
      expect(position.right).toBeLessThan(2);
      expect(position.left).toBeGreaterThan(10);
      const details = answer.locator('[data-tour="assistant-citations"]');
      await expect(details).not.toHaveAttribute('open', '');
      await expect(answer.locator('.answer')).toContainText(passage.text);
      const marker = answer.getByRole('button', {
        name: 'Sumber 1 · ' + doc.title + ' · hal. ' + passage.page,
      });
      await marker.focus();
      await marker.press('Enter');
      const inspector = page.getByRole('dialog', { name: 'Kutipan berkas' });
      await expect(inspector.locator('blockquote')).toHaveText(passage.text);
      await inspector.getByRole('button', { name: 'Tutup', exact: true }).press('Escape');
      await expect(inspector).toHaveCount(0);
      await expect(marker).toBeFocused();

      const composer = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
      await checkComposer(page, composer);
      await info.attach('conversation', {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
      const card = details.getByRole('button', { name: new RegExp(doc.title) });
      await expect(card).toContainText('hal. ' + passage.page);
      expect((await answer.innerText()).split(passage.text).length - 1).toBe(1);
      await card.click();
      await inspector.getByRole('button', { name: 'Tutup', exact: true }).click();
      await expect(card).toBeFocused();
      await card.click();
      await inspector.getByRole('link', { name: 'Buka sumber' }).click();
      await expect(page).toHaveURL(new RegExp('/documents/' + doc.id + '\\?p=' + passage.id + '$'));
      await page.goBack();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByRole('log').locator('details[open]')).toHaveCount(0);
      if (phone) {
        await page.getByRole('link', { name: 'Semua percakapan' }).tap();
        await expect(rail).toBeVisible();
        await expect(page.getByRole('log')).toBeHidden();
      }
    });

    test('keeps a long, source-grounded conversation scrollable above its composer', async ({
      page,
    }, info) => {
      await page.goto('/demo/assistant/new?context=document%3Ad2&context=document%3Ad3');
      const field = page.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
      const send = page.getByRole('button', { name: 'Kirim pertanyaan' });
      const log = page.getByRole('log');
      const answers = log.locator('[data-tour="assistant-answer"]');
      for (const [i, prompt] of [
        'Siapa yang memegang kunci dan kapan truk melalui gerbang?',
        'Periksa juga keterangan saksi dan waktu yang dicatat petugas.',
        'Apa sumber untuk mencocokkan catatan kunci dengan log gerbang?',
      ].entries()) {
        await field.fill(prompt);
        await send.click();
        await expect(answers).toHaveCount(i + 1);
        await expect(answers.nth(i).locator('.answer .citation')).not.toHaveCount(0);
        await expect(answers.nth(i).locator('details[open]')).toHaveCount(0);
        await expect(log.locator('.message.question').nth(i).getByRole('link')).toHaveCount(2);
      }
      await expect(page).toHaveURL(/\/assistant\/[a-f\d-]{36}$/);
      await expect.poll(() => log.evaluate((n) => n.scrollHeight - n.clientHeight)).toBeGreaterThan(400);
      await checkComposer(page, field);
      const before = await field.boundingBox();
      await log.evaluate((n) => n.scrollTo(0, 0));
      await expect(log.locator('.question').first()).toBeInViewport();
      await checkComposer(page, field);
      expect(await field.boundingBox()).toEqual(before);
      await info.attach('long-conversation', {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await page.reload();
      await expect(answers).toHaveCount(3);
      await expect(log.locator('details[open]')).toHaveCount(0);
    });
  });
}

test('an English narrow screen retains saved narrative, original words and unavailable citations', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto('/demo');
  const origin = new URL(page.url()).origin;
  await context.addCookies([{ name: 'jude_lang', value: 'en', url: origin }]);
  const files = unzipSync(await readFile(new URL('./fixtures/hearing-playback.jude', import.meta.url)));
  const archive = JSON.parse(strFromU8(files['case.json']));
  const statement = archive.statements[0];
  statement.text = 'Ucapan uji [1] sintetis. **Asli**\n- tetap sebagai kutipan.';
  const citation = { kind: 'statement', id: statement.id };
  const quoted = '“' + statement.text + '” [1]';
  const unavailable = {
    kind: 'passage',
    id: 'former-page',
    unavailable: true,
    snapshot: 'Kalimat halaman yang dihapus.',
  };
  const law = {
    id: 'provision',
    type: 'UU',
    article: 'Pasal 235',
    regulation: 'UU Nomor 20 Tahun 2025',
    provider: 'pasal',
    sourceUrl: 'https://pasal.id/peraturan/uu/uu-no-20-tahun-2025/pasal-235',
    summary: { id: 'Rujukan tersimpan tentang alat bukti.', en: 'Saved reference on forms of evidence.' },
    keywords: [],
  };
  archive.legal = [law];
  archive.threads = [
    {
      id: 'saved-conversation',
      title: 'Original wording and historical evidence',
      updated: 1,
      messages: [
        { role: 'user', text: 'What was recorded?', contexts: [citation] },
        {
          role: 'assistant',
          mode: 'sources-only',
          text: 'The file contains a second account. ' + quoted,
          citations: [citation],
        },
        {
          role: 'assistant', mode: 'ai', citations: [citation], legal: [law.id],
          text: [
            '## Witness accounts', 'The **two _accounts_** differ [1].',
            '- The witness described the entrance [1].\n- The second account concerns a later time.',
            '### Questions for review', '3. Compare the timing.\n4. Ask about the entrance [1].',
            'Original wording: ' + quoted,
            'Unverified [outside page](https://example.test/record) and <b>archived text</b>.',
          ].join('\n\n'),
        },
        {
          role: 'assistant',
          mode: 'sources-only',
          text: 'The earlier record [2] differs from the testimony [1].',
          citations: [citation, unavailable],
        },
      ],
    },
  ];
  files['case.json'] = strToU8(JSON.stringify(archive));
  const imported = await page.request.post('/api/cases/import', {
    headers: { origin },
    multipart: {
      file: {
        name: 'assistant-history.jude',
        mimeType: 'application/zip',
        buffer: Buffer.from(zipSync(files)),
      },
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const w = await workspace(page, (await imported.json()).id);
  await page.goto('/case/' + w.caseRecord.id + '/assistant/' + w.threads[0].id);
  const log = page.getByRole('log', { name: 'Conversation messages' });
  const answers = log.locator('[data-tour="assistant-answer"]');
  await expect(answers).toHaveCount(3);
  await expect(log.locator('details[open]')).toHaveCount(0);
  await expect(answers.nth(0).locator('.answer')).toContainText(
    'The file contains a second account. “' + statement.text + '”',
  );
  await expect(answers.nth(1).locator('.answer')).toContainText(statement.text);
  const formatted = answers.nth(1).locator('.answer');
  await expect(formatted.getByRole('heading', { level: 3 })).toHaveText('Witness accounts');
  await expect(formatted.getByRole('heading', { level: 4 })).toHaveText('Questions for review');
  await expect(formatted.locator('strong > em')).toHaveText('accounts');
  await expect(formatted.locator('strong > em')).toHaveCSS('font-synthesis', 'style');
  expect(await formatted.locator('p').first().textContent()).toBe('The two accounts differ 1.');
  await expect(formatted.locator('ul > li')).toHaveCount(2);
  await expect(formatted.locator('ol')).toHaveAttribute('start', '3');
  await expect(formatted.locator('ol > li')).toHaveCount(2);
  await expect(formatted.locator('.citation')).toHaveCount(4);
  await expect(formatted.locator('.verbatim')).toHaveText('“' + statement.text + '”');
  await expect(formatted.locator('.verbatim :is(strong, em, .citation)')).toHaveCount(0);
  await expect(formatted.getByText(/<b>archived text<\/b>/)).toBeVisible();
  await expect(formatted.locator('b, a[href^="https://example.test"]')).toHaveCount(0);
  await expect(answers.nth(2).locator('.answer')).toContainText(
    'The earlier record [2] differs from the testimony',
  );
  await answers.nth(0).locator('summary').click();
  await expect(answers.nth(0).locator('.source-quote')).toHaveText('“' + statement.text + '”');
  const caseSources = answers.nth(1).locator('[data-tour="assistant-citations"]');
  await caseSources.locator('summary').click();
  await expect(caseSources.locator('.source-quote')).toHaveText('“' + statement.text + '”');
  const lawSources = answers
    .nth(1)
    .locator('details')
    .filter({ has: page.getByText('Legal references · 1', { exact: true }) });
  await expect(lawSources).not.toHaveAttribute('open', '');
  await lawSources.locator('summary').click();
  const legalCard = lawSources.getByRole('button', { name: /Pasal 235/ });
  await legalCard.click();
  const legalInspector = page.getByRole('dialog', { name: 'Legal reference' });
  await expect(legalInspector).toContainText(law.summary.en);
  await expect(legalInspector.getByRole('link', { name: 'Open source on Pasal.id' })).toHaveAttribute(
    'href',
    law.sourceUrl,
  );
  await legalInspector.getByRole('button', { name: 'Close', exact: true }).press('Escape');
  await expect(legalCard).toBeFocused();
  await answers.nth(2).locator('summary').click();
  const lost = answers.nth(2).locator('li').nth(1);
  await expect(lost).toContainText('Source removed');
  await expect(lost).toContainText(unavailable.snapshot);
  await expect(lost.locator('a,button')).toHaveCount(0);
  await expect(lost.locator('.num')).toHaveText('2');
  await expect(answers.nth(2).getByRole('button', { name: /^Source 1/ })).toHaveCount(1);
  await checkComposer(page, page.getByRole('textbox', { name: 'Question for the assistant' }));
});
