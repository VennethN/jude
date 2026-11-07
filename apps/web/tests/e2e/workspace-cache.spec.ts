import { expect, test, type Page } from '@playwright/test';

async function guest(page: Page, origin: string) {
  const response = await page.request.post('/api/auth/demo', { headers: { origin } });
  expect(response.ok()).toBe(true);
  const { demo } = await response.json();
  return '/case/' + demo.caseId;
}

async function follow(page: Page, path: string) {
  await page
    .locator('a[href="' + path + '"]:visible')
    .first()
    .click();
  await expect(page).toHaveURL((url) => url.pathname === path);
}

function observeData(page: Page) {
  const paths: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === 'GET' &&
      (path.endsWith('/__data.json') || (path.startsWith('/api/') && !path.endsWith('/events')))
    )
      paths.push(path);
  });
  return paths;
}

test('case returns reuse tab memory, detail routes make no data request, and a hard refresh reads the server', async ({
  page,
  context,
  baseURL,
}) => {
  const path = await guest(page, baseURL!);
  const snapshot = '/api/cases/' + path.split('/').pop() + '/workspace';
  const paths = observeData(page);
  await page.goto('/cases');
  await expect(page.locator('.case-grid')).toBeVisible();
  await follow(page, path);
  await expect(page.locator('.overview h1')).toBeVisible();
  expect(paths.filter((item) => item === snapshot)).toHaveLength(1);

  paths.length = 0;
  await follow(page, path + '/documents');
  await follow(page, path + '/documents/d1');
  await follow(page, path + '/hearings');
  await follow(page, path + '/hearings/h1');
  // The PDF viewer is its own resource and retains its normal authenticated response.
  expect(paths.filter((item) => !item.endsWith('/viewer') && !item.endsWith('/original'))).toEqual([]);

  paths.length = 0;
  await follow(page, '/cases');
  await follow(page, path);
  expect(paths).toEqual(['/cases/__data.json', path + '/__data.json']);

  const other = await context.newPage();
  const otherPaths = observeData(other);
  await other.goto('/cases');
  await follow(other, path);
  expect(otherPaths.filter((item) => item === snapshot)).toHaveLength(1);
  await other.close();

  const title = 'Berkas uji — diperbarui di luar tab';
  const saved = await page.request.patch('/api/cases/' + path.split('/').pop(), {
    headers: { origin: baseURL! },
    data: { title },
  });
  expect(saved.ok()).toBe(true);
  const fresh = await page.reload();
  expect(fresh?.headers()['cache-control']).toBe('private, no-store');
  expect(await fresh?.text()).toContain(title);
  await expect(page.locator('.overview h1')).toHaveText(title);
});

test('a real edit refreshes a second open register and loss of case access closes an open file', async ({
  page,
  context,
  baseURL,
}) => {
  await guest(page, baseURL!);
  const created = await page.request.post('/api/cases', {
    headers: { origin: baseURL! },
    data: { title: 'Berkas lokal untuk pemeriksaan akses' },
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  await page.goto('/case/' + id);
  const register = await context.newPage();
  await register.goto('/cases');
  await expect(register.locator('.case-grid')).toContainText('Berkas lokal untuk pemeriksaan akses');

  await page.getByRole('button', { name: 'Menu ruang kerja' }).click();
  await page.getByRole('button', { name: 'Tindakan perkara' }).click();
  await page.getByRole('button', { name: 'Pengaturan perkara' }).click();
  const revisedTitle = 'Berkas uji — perubahan dari tab lain';
  await page.getByLabel('Judul perkara').fill(revisedTitle);
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.locator('.overview h1')).toHaveText(revisedTitle);
  await expect(register.locator('.case-grid')).toContainText(revisedTitle);

  const remoteTitle = 'Berkas uji — pembaruan dari server';
  const remote = await register.request.patch('/api/cases/' + id, {
    headers: { origin: baseURL! },
    data: { title: remoteTitle },
  });
  expect(remote.ok()).toBe(true);
  await expect(page.locator('.overview h1')).toHaveText(remoteTitle);

  const removed = await register.request.delete('/api/cases/' + id, { headers: { origin: baseURL! } });
  expect(removed.ok()).toBe(true);
  await expect(page).toHaveURL(/\/cases\?notice=case-unavailable$/);
  await expect(page.locator('.case-grid')).not.toContainText(remoteTitle);
  await register.close();
});

test('replacing the shared session in a second tab discards the previous account', async ({
  page,
  context,
  baseURL,
}) => {
  const path = await guest(page, baseURL!);
  await page.goto(path);
  const firstTitle = await page.locator('.overview h1').innerText();
  const other = await context.newPage();
  const replacement = await other.request.post('/api/auth/signup', {
    headers: { origin: baseURL! },
    data: { name: 'Pemilik baru', email: crypto.randomUUID() + '@example.test', password: 'Private-file9' },
  });
  expect(replacement.ok()).toBe(true);
  await other.goto('/cases');
  await expect(other.getByRole('heading', { name: 'Perkara Anda' })).toBeVisible();
  await expect(page).toHaveURL(/\/cases\?notice=case-unavailable$/);
  await expect(page.locator('main')).not.toContainText(firstTitle);
  const denied = await page.request.get('/api/cases/' + path.split('/').pop() + '/workspace');
  expect(denied.status()).toBe(404);
  expect(denied.headers()['cache-control']).toBe('private, no-store');
});

test('overview and hearing navigation share voice readiness and retry a transient failure', async ({
  page,
  baseURL,
}) => {
  await guest(page, baseURL!);
  const created = await page.request.post('/api/cases', {
    headers: { origin: baseURL! },
    data: { title: 'Berkas uji suara' },
  });
  expect(created.ok()).toBe(true);
  const path = '/case/' + (await created.json()).id;
  let probes = 0;
  await page.route('**/api/voice-capability', (route) => {
    probes++;
    return route.fulfill({ status: probes === 1 ? 503 : 200, json: { transcription: probes > 1 } });
  });
  await page.goto('/cases');
  await follow(page, path);
  await follow(page, path + '/hearings');
  expect(probes).toBe(1);
  await follow(page, path + '/documents');
  await page.clock.setFixedTime(new Date(Date.now() + 6000));
  await follow(page, path);
  expect(probes).toBe(2);
  await follow(page, path + '/hearings');
  expect(probes).toBe(2);
});

test('Back rechecks access before reopening a previously cached case', async ({ page, baseURL }) => {
  const path = await guest(page, baseURL!);
  await page.goto('/cases');
  await follow(page, path);
  const title = await page.locator('.overview h1').innerText();
  await follow(page, '/cases');
  const removed = await page.request.delete('/api/cases/' + path.split('/').pop(), {
    headers: { origin: baseURL! },
  });
  expect(removed.ok()).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/\/cases\?notice=case-unavailable$/);
  await expect(page.locator('main')).not.toContainText(title);
});
