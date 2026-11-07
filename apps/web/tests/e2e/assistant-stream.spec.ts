import { expect, test, type Page } from '@playwright/test';
import type { AnswerStreamEvent, ChatMessage, Thread } from '@jude/core/domain';

type Stage = 'fragment' | 'paragraph' | 'all' | 'complete' | 'lost';
interface Gate {
  keys: string[];
  path: string;
  cancelled: boolean;
  release: (stage: Stage) => Promise<string | undefined>;
}
declare global { interface Window { answerGate: Gate } }

// Split the real, already-checked response into deliberately slow network chunks. The route, records,
// credentials, idempotency key, final transaction and citation targets all remain the application's own.
async function holdResponse(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const gate: Gate = { keys: [], path: '', cancelled: false, release: async () => undefined };
    window.answerGate = gate;
    window.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method !== 'POST' || !/\/threads\/[^/]+\/messages$/.test(request.url) ||
          !request.headers.get('accept')?.includes('application/x-ndjson')) return original(input, init);
      gate.keys.push(request.headers.get('idempotency-key')!);
      gate.path = new URL(request.url).pathname.replace(/\/messages$/, '');
      gate.cancelled = false;
      const result = original(request).then(async response => {
        const body = await response.text();
        if (!response.ok) throw new Error(body);
        return body.trim().split('\n').map(line => JSON.parse(line) as AnswerStreamEvent);
      });
      const encoder = new TextEncoder();
      const encode = (event: AnswerStreamEvent) => encoder.encode(JSON.stringify(event) + '\n');
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encode({ type: 'status', phase: 'reading' }));
          request.signal.addEventListener('abort', () => { gate.cancelled = true; controller.close(); }, { once: true });
          let fragment: Uint8Array | undefined;
          gate.release = async (stage) => {
            const events = await result;
            const final = events.find(event => event.type === 'complete');
            if (!final) throw new Error('The assistant did not commit the thread');
            if (stage === 'complete') { controller.enqueue(encode(final)); controller.close(); return; }
            if (stage === 'lost') { controller.close(); return; }
            const partial = events.find(event => event.type === 'partial')?.message;
            if (!partial?.citations?.length || typeof partial.text !== 'string') throw new Error('Missing verified source');
            const first: ChatMessage = { ...partial, text: partial.text.split('\n\n')[0], citations: partial.citations.slice(0, 1) };
            if (stage === 'fragment') {
              const bytes = encode({ type: 'partial', message: first });
              // Split inside the UTF-8 encoding of the opening quotation mark.
              const cut = bytes.indexOf(0xe2) + 1;
              if (cut < 1) throw new Error('Missing quoted source');
              fragment = bytes.slice(cut);
              controller.enqueue(bytes.slice(0, cut));
            } else if (stage === 'paragraph') {
              controller.enqueue(fragment ?? encode({ type: 'partial', message: first }));
              fragment = undefined;
            } else {
              controller.enqueue(encode({ type: 'partial', message: partial }));
            }
            return (stage === 'all' ? partial.text : first.text) as string;
          };
        },
      }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
}
async function openWorkspace(page: Page, path: string) {
  const hydrated = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/events'));
  await page.goto(path);
  await hydrated;
}
const release = (page: Page, stage: Stage) => page.evaluate(stage => window.answerGate.release(stage), stage);

for (const { name, width, height, drawer } of [
  { name: 'full assistant', width: 1440, height: 900, drawer: false },
  { name: 'Documents drawer', width: 390, height: 844, drawer: true },
]) {
  test(name + ' shows the question and checked citations before the final answer arrives', async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await holdResponse(page);
    await openWorkspace(page, drawer ? '/demo/documents' : '/demo/assistant/new');
    if (drawer) await page.getByRole('button', { name: 'Buka asisten perkara' }).click();
    const root = drawer ? page.getByRole('dialog', { name: 'Asisten perkara' }) : page.locator('.assistant-page');
    const log = root.getByRole('log');
    const field = root.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
    const question = 'Kapan kartu akses digunakan di Gerbang Timur?';
    await field.fill(question);
    await field.press('Enter');
    await expect(log.locator('.message.question .answer')).toHaveText(question);
    await expect(log.locator('.message.question header')).toHaveText('Anda');
    await expect(log.locator('.message.question a.context-chip')).toHaveAttribute('href', drawer ? /\/documents$/ : /\/case\/[^/]+$/);
    await expect(log.getByText('Pertanyaan yang disarankan')).toHaveCount(0);
    await expect(log.locator('.reading-lines > i')).toHaveCount(3);
    await expect(log.getByRole('status')).toBeInViewport();
    expect(await log.locator('.reading-lines').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    const gap = () => log.locator('.message.question').evaluate(node =>
      Math.abs(node.getBoundingClientRect().right - node.parentElement!.getBoundingClientRect().right));
    expect(await gap()).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath('reading.png') });
    await expect.poll(() => page.evaluate(() => window.answerGate.keys.length)).toBe(1);
    await release(page, 'fragment');
    await expect(log.locator('.message.response')).toHaveCount(0);
    await expect(log.getByRole('status')).toBeVisible();
    const first = await release(page, 'paragraph');
    await expect(log.locator('.reading')).toHaveCount(0);
    const answer = log.locator('.message.response');
    await expect(answer.locator('.answer')).toContainText(first!.split(' [')[0]);
    const marker = answer.locator('.answer .citation').first();
    await expect(marker).toBeVisible();
    expect(await marker.getAttribute('aria-label')).toMatch(/^Sumber 1/);
    await answer.locator('summary').first().click();
    await expect(answer.locator('details[open] li')).toHaveCount(1);
    await release(page, 'all');
    await expect.poll(() => answer.locator('details[open] li').count()).toBeGreaterThan(1);
    await expect(log.locator('.message.question')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('checked-paragraphs.png') });
    await release(page, 'complete');
    await expect(root.getByRole('button', { name: 'Kirim pertanyaan' })).toBeDisabled();
    await expect(log.locator('.message.question')).toHaveCount(1);
    await expect(answer).toHaveCount(1);
    expect(await gap()).toBeLessThan(2);
    if (!drawer) await expect(page).toHaveURL(/\/assistant\/(?!new)[^/]+$/);
    if (drawer) {
      // Keeping the shared display slot also preserves an open citation disclosure across the final frame.
      await expect(answer.locator('details[open]')).toHaveCount(1);
      await root.getByRole('button', { name: 'Tutup asisten' }).click();
      await expect(root).toHaveCount(0);
      await page.getByRole('button', { name: 'Buka asisten perkara' }).click();
      await expect(log.locator('.message.question')).toHaveCount(1);
      await expect(answer).toHaveCount(1);
    }
  });
}

test('an interrupted delivery can be retried from a reopened drawer without a second saved question', async ({ page }) => {
  await holdResponse(page);
  await openWorkspace(page, '/demo/documents');
  const open = page.getByRole('button', { name: 'Buka asisten perkara' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Asisten perkara' });
  const question = 'Kapan saksi masuk melalui Gerbang Timur?';
  const field = dialog.getByRole('textbox', { name: 'Pertanyaan untuk asisten' });
  await field.fill(question);
  await field.press('Enter');
  await expect.poll(() => page.evaluate(() => window.answerGate.keys.length)).toBe(1);
  await release(page, 'paragraph');
  await expect(dialog.locator('.message.response')).toHaveCount(1);
  await release(page, 'lost');
  await expect(dialog.getByRole('alert')).toContainText('Sambungan terputus');
  await expect(field).toHaveValue(question);
  await expect(dialog.locator('.reading')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Tutup asisten' }).click();
  await open.click();
  await field.fill(question);
  await field.press('Enter');
  await expect.poll(() => page.evaluate(() => window.answerGate.keys.length)).toBe(2);
  const { keys, path } = await page.evaluate(() => ({ keys: window.answerGate.keys, path: window.answerGate.path }));
  expect(keys[0]).toBe(keys[1]);
  await release(page, 'complete');
  await expect(dialog.locator('.message.question')).toHaveCount(1);
  const thread: Thread = await (await page.request.get(path)).json();
  expect(thread.messages.map(message => message.role)).toEqual(['user', 'assistant']);
  expect(thread.messages[0].contexts).toEqual([{ kind: 'documents' }]);
});
