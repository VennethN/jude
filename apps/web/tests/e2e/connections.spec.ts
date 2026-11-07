import { expect, test, type Page } from '@playwright/test';

const finding = 'finding:f3';
const statement = 'statement:s221';
const passage = 'passage:d2p2';

function card(page: Page, key: string) {
  return page.locator('.map .cell[data-key="' + key + '"]');
}

function member(page: Page, key: string) {
  return page.locator('.group-panel [data-member="' + key + '"] .member-main');
}

async function openGroup(page: Page, key = finding) {
  await page.goto('/demo/connections?of=' + encodeURIComponent(key));
  await expect(card(page, key)).toHaveClass(/\bopen\b/);
  await expect(page.locator('.map')).toHaveAttribute('data-progress', '1');
  await page.evaluate(() => document.fonts.ready);
}

test('read the chosen source, move by pointer and keyboard, and recover the selection through history', async ({
  page
}) => {
  await openGroup(page);
  const panel = page.locator('.group-panel');
  const map = page.locator('.map');
  await expect(panel.locator('.group-head p')).toHaveText('3 bukti · 2 pasangan');
  await expect(card(page, finding)).toContainText('BAP Saksi Dimas halaman 2');
  await expect(card(page, finding).getByRole('link')).toHaveAttribute('href', /\/findings\/f3$/);
  await expect(panel.locator('[data-member]')).toHaveCount(3);
  await expect(map).toHaveAttribute('data-orientation', 'rows');

  const context = page.locator('[data-filter="context"]');
  await context.click();
  await expect(context).toHaveAttribute('aria-pressed', 'false');
  await expect(map.locator('path[data-rel="context"]')).toHaveCount(0);
  await expect(panel.locator('.pair')).toHaveCount(2);
  await context.click();

  await card(page, passage).click();
  await expect(card(page, passage).getByRole('link')).toHaveAttribute('href', /\/documents\/d2\?p=d2p2$/);
  await page.goBack();
  await expect(card(page, finding)).toHaveAttribute('aria-current', 'true');
  await page.goForward();
  await expect(card(page, passage)).toHaveAttribute('aria-current', 'true');

  await member(page, statement).click();
  await expect(card(page, statement).getByRole('link')).toHaveAttribute('href', /\/hearings\/h2\?s=s221$/);
  await map.scrollIntoViewIfNeeded();
  const bounds = (await map.boundingBox())!;
  const world = page.locator('.map .world');
  const before = await world.getAttribute('style');
  await page.mouse.move(bounds.x + 18, bounds.y + 35);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(world).not.toHaveAttribute('style', before!);
  await card(page, statement).focus();
  await page.keyboard.press('ArrowDown');
  await expect(card(page, finding)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card(page, finding)).toHaveAttribute('aria-current', 'true');
  await expect(map.locator('.cell[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/connections$/);
  await expect(card(page, finding)).toBeFocused();
  await expect(map).toHaveAttribute('data-orientation', 'overview');
});

test('group lines stay in their own routes even when other cards lie between endpoints', async ({ page }) => {
  for (const key of [finding, 'finding:f1']) {
    await openGroup(page, key);
    const { lines, cards, violations } = await page.locator('.map .world').evaluate((world) => {
      const cards = Array.from(world.querySelectorAll<HTMLElement>('.cell[data-key]:not([inert])')).map((node) => {
        const transform = new DOMMatrix(node.style.transform);
        return {
          key: node.dataset.key!,
          x: transform.e,
          y: transform.f,
          w: parseFloat(node.style.width),
          h: parseFloat(node.style.height)
        };
      });
      const paths = Array.from(world.querySelectorAll<SVGPathElement>('[data-pair]'));
      const violations: string[] = [];
      for (const line of paths) {
        const other = cards.filter((card) => card.key !== line.dataset.from && card.key !== line.dataset.to);
        const length = line.getTotalLength();
        for (let at = 0; at < length; at += 2) {
          const p = line.getPointAtLength(at);
          const hit = other.find(
            (c) => p.x > c.x + 1 && p.x < c.x + c.w - 1 && p.y > c.y + 1 && p.y < c.y + c.h - 1
          );
          if (hit) {
            violations.push(line.dataset.pair + ' crossed ' + hit.key);
            break;
          }
        }
      }
      return { lines: paths.length, cards: cards.length, violations };
    });
    expect(violations).toEqual([]);
    expect(cards).toBeGreaterThanOrEqual(key === finding ? 3 : 6);
    expect(lines).toBeGreaterThanOrEqual(key === finding ? 2 : 5);
  }
});

test('source selection eases through intermediate positions and settles immediately when motion is reduced', async ({
  page
}) => {
  await openGroup(page);
  for (const motion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    await expect(page.locator('.map')).toHaveAttribute('data-progress', '1');
    const key = motion === 'reduce' ? finding : statement;
    const frames = await page.evaluate(
      async ({ key, finding }) => {
        const root = document.querySelector<HTMLElement>('.map')!;
        const world = root.querySelector<HTMLElement>('.world')!;
        const button = root.querySelector<HTMLButtonElement>('[data-key="' + key + '"]')!;
        const read = () => {
          const node = root.querySelector<HTMLElement>('[data-key="' + finding + '"]')!;
          return {
            progress: Number(root.dataset.progress),
            width: parseFloat(node.style.width),
            camera: world.style.transform
          };
        };
        const samples = [read()];
        button.click();
        await new Promise<void>((resolve) => {
          const initial = performance.now();
          const sample = () => {
            samples.push(read());
            if (performance.now() - initial > 1300) resolve();
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        return samples;
      },
      { key, finding }
    );
    await expect(card(page, key)).toHaveAttribute('aria-current', 'true');
    if (motion === 'no-preference') {
      const steps = frames.filter((f) => f.progress > 0.05 && f.progress < 0.95);
      expect(steps.length).toBeGreaterThan(2);
      expect(steps.some((f) => f.width > 190 && f.width < 315)).toBe(true);
      expect(new Set(steps.map((f) => f.camera)).size).toBeGreaterThan(2);
    } else {
      expect(frames.every((f) => f.progress === 1)).toBe(true);
      expect(frames.every((f) => f.width === 188 || f.width === 320)).toBe(true);
    }
    expect(frames.at(-1)?.progress).toBe(1);
  }
});

test('phone selection brings the group into reach and sends all its sources to the assistant', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGroup(page);
  await member(page, passage).click();
  await expect(page.locator('#connection-group-name')).toBeFocused();
  await expect(card(page, passage).getByRole('link')).toHaveAttribute('href', /\/documents\/d2\?p=d2p2$/);
  const ask = page.locator('.group-panel').getByRole('link', { name: 'Tanya asisten' });
  const contexts = new URL((await ask.getAttribute('href'))!, page.url()).searchParams.getAll('context');
  expect(new Set(contexts)).toEqual(new Set([finding, statement, passage]));
  await ask.click();
  await expect(page.locator('.contexts button.chip')).toHaveCount(3);
  const first = page.locator('.contexts button.chip').first();
  await expect(first).toHaveAccessibleName(/Hapus konteks BAP Saksi Dimas/);
  await first.click();
  await expect(page.locator('.contexts button.chip')).toHaveCount(2);
});

test('pair a new member, update its relation, and restore its group after removal', async ({ page }) => {
  await openGroup(page, statement);
  const panel = page.locator('.group-panel');
  await panel.locator('.head-actions').getByRole('button', { name: 'Pasangkan dengan bukti lain' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Bukti kedua').selectOption('statement:s101');
  const [created] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/connections$/.test(r.url())),
    form.getByRole('button', { name: 'Simpan pasangan' }).click()
  ]);
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  const pair = panel.locator('[data-pair="' + id + '"]');
  await expect(panel.locator('.group-head p')).toHaveText('4 bukti · 3 pasangan');
  await pair.getByRole('combobox', { name: 'Jenis hubungan' }).selectOption('supports');
  await expect(page.locator('.map path[data-pair="' + id + '"]')).toHaveAttribute('data-rel', 'supports');
  await page.reload();
  await expect(pair.getByRole('combobox')).toHaveValue('supports');
  await pair.getByRole('button', { name: 'Lepas', exact: true }).click();
  await expect(panel.locator('.group-head p')).toHaveText('3 bukti · 2 pasangan');
  await page.getByRole('button', { name: 'Urungkan', exact: true }).click();
  await expect(panel.locator('.group-head p')).toHaveText('4 bukti · 3 pasangan');
  await expect(pair.getByRole('combobox')).toHaveValue('supports');
  await member(page, 'statement:s101').click();
  await expect(card(page, 'statement:s101').getByRole('link')).toHaveAttribute('href', /\/hearings\/h1\?s=s101$/);
});
