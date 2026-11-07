import { expect, test } from '@playwright/test';
import type { Board, Workspace } from '@jude/core/domain';

test('the passage index opens the complete source, copies its address and files one board card', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await page.goto('/demo/documents/d1?p=d1p4');
  const document = new URL(page.url());
  const api = '/api/cases/' + document.pathname.split('/')[2];
  const workspace = async (): Promise<Workspace> => (await page.request.get(api + '/workspace')).json();
  const passage = (await workspace()).passages.find(p => p.id === 'd1p4')!;
  const index = page.locator('[data-tour="doc-passages"]');
  const open = index.getByRole('button', {name:'Buka kutipan 4'});
  await expect(open).toBeEnabled();
  await open.focus();
  await open.press('Enter');
  const inspector = page.getByRole('dialog', {name:'Kutipan berkas'});
  await expect(inspector.locator('blockquote')).toHaveText(passage.text);
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await index.getByRole('button', {name:'Salin tautan · Kutipan 4'}).click();
  await expect(index).toContainText('Tautan kutipan disalin.');
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.pathname).toBe(document.pathname);
  expect(copied.searchParams.get('p')).toBe(passage.id);
  expect(copied.searchParams.get('view')).toBe('text');

  const add = index.getByRole('button', {name:'Tambah ke papan · Kutipan 4'});
  await add.focus();
  await add.press('Enter');
  const board = index.getByRole('link', {name:/Buka papan/});
  await expect(board).toBeFocused();
  await expect(page).toHaveURL(document.href);
  expect((await workspace()).boards[0].cards.map(c => c.key)).toEqual(['passage:d1p4']);
  await page.reload();
  await board.click();
  await expect(page.locator('.board-count')).toContainText('1 kartu');
  await page.goto(copied.href);
  await expect(page.locator('.passage-block.focused')).toContainText(passage.text);
});

test('on a phone the index expands before the paper and saves to the chosen board', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/demo/documents/d1');
  const api = '/api/cases/' + new URL(page.url()).pathname.split('/')[2];
  const first: Board = await (await page.request.post(api + '/boards',{data:{name:'Persiapan'}})).json();
  const second: Board = await (await page.request.post(api + '/boards',{data:{name:'Sidang besok'}})).json();
  await page.reload();
  const index = page.locator('[data-tour="doc-passages"]');
  const toggle = index.getByRole('button',{name:/Kutipan halaman ini/});
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await toggle.focus();
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  const excerpt = index.locator('.words');
  await expect(excerpt).toHaveCSS('-webkit-line-clamp','2');
  expect(await page.evaluate(() => {
    const rail = document.querySelector('[data-tour="doc-passages"]')!;
    return rail.getBoundingClientRect().bottom <= document.querySelector('[data-tour="reader-tools"]')!.getBoundingClientRect().top
      && document.documentElement.scrollWidth === innerWidth;
  })).toBe(true);
  await index.getByRole('button',{name:'Tambah ke papan · Kutipan 1'}).click();
  const dialog = page.getByRole('dialog',{name:'Tambah ke papan'});
  await dialog.getByLabel('Pilih papan').selectOption(second.id);
  await dialog.getByRole('button',{name:'Tambahkan'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(index.getByRole('link',{name:'Sidang besok'})).toBeVisible();
  const boards: Board[] = (await (await page.request.get(api+'/workspace')).json()).boards;
  expect(boards.find(b => b.id === first.id)?.cards).toEqual([]);
  expect(boards.find(b => b.id === second.id)?.cards.map(c => c.key)).toEqual(['passage:d1p1']);
});
