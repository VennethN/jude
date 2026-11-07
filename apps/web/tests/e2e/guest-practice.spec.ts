import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures/practice';

async function voicedMicrophone(page: Page, denyFirst = false) {
  await page.addInitScript(denyFirst => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const count = Number(sessionStorage.getItem('mic-count') || 0) + 1;
      sessionStorage.setItem('mic-count', String(count));
      if (denyFirst && count === 1) throw new DOMException('Permission denied', 'NotAllowedError');
      const audio = new AudioContext({ sampleRate: 24000 });
      const tone = audio.createOscillator();
      const outlet = audio.createMediaStreamDestination();
      tone.connect(outlet);
      tone.start();
      await audio.resume();
      (window as Window & { practiceInput?: MediaStream }).practiceInput = outlet.stream;
      return outlet.stream;
    } });
  }, denyFirst);
}
for (const practice of [true, false]) {
  test('explicit Start connects the ' + (practice ? 'guest practice' : 'private') + ' microphone once', async ({ page, baseURL }) => {
    const headers = { origin: baseURL! };
    let caseId: string;
    if (practice) {
      const response = await page.request.post('/api/auth/demo', { headers });
      caseId = (await response.json()).demo.caseId;
    } else {
      const signup = await page.request.post('/api/auth/signup', { headers,
        data: { name: 'Counsel', email: randomUUID() + '@example.test', password: 'Fixture-1234', planId: 'pro' } });
      expect(signup.ok()).toBe(true);
      const created = await page.request.post('/api/cases', { headers, data: { title: 'Private hearing test' } });
      caseId = (await created.json()).id;
    }
    await page.request.patch('/api/me/prefs', { headers, data: { tourSeen: true } });
    await voicedMicrophone(page);
    const sent: boolean[] = [];
    let connections = 0;
    await page.routeWebSocket('**/api/live/*/*/socket*', ws => {
      connections++;
      ws.onMessage(raw => {
        const packet = JSON.parse(String(raw));
        if (packet.type === 'stop') { ws.send(JSON.stringify({ type: 'stopped' })); return; }
        sent.push(packet.keep);
        ws.send(JSON.stringify({ type: 'accepted', id: packet.id }));
        ws.send(JSON.stringify({ type: 'ack', id: packet.id }));
        if (practice) {
          ws.send(JSON.stringify({ type: 'error', code: 'guest_live_limit' }));
          ws.close({ code: 1008, reason: 'guest_live_limit' });
        }
      });
      ws.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 3 }));
    });
    await page.goto('/case/' + caseId + '/hearings?new=live');
    const form = page.getByRole('dialog');
    if (!practice) await form.getByLabel('Judul sidang').fill('Sidang uji');
    await form.getByRole('checkbox', { name: practice ? /Saya setuju/ : /Hakim ketua/ }).check();
    expect(await page.evaluate(() => sessionStorage.getItem('mic-count'))).toBeNull();
    await form.getByRole('button', { name: 'Mulai sidang', exact: true }).click();
    await expect(page).toHaveURL(/\/hearings\/[\w-]+$/);
    await expect.poll(() => sent.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(sent[0]).toBe(false);
    expect(await page.evaluate(() => sessionStorage.getItem('mic-count'))).toBe('1');
    if (practice) {
      await expect(page.getByRole('status').filter({ hasText: '5 menit audio latihan' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Hubungkan mikrofon' })).toHaveCount(0);
    } else {
      const reads: string[] = [];
      const baseline = sent.length;
      page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (/\/(?:workspace|events|__data\.json)$/.test(path)) reads.push(path);
      });
      await expect.poll(() => sent.length).toBeGreaterThanOrEqual(baseline + 3);
      expect(reads).toEqual([]);
    }
    await page.getByRole('button', { name: 'Akhiri sidang', exact: true }).click();
    await page.getByRole('button', { name: 'Akhiri dan tinjau' }).click();
    await expect(page.locator('.session-control')).toHaveCount(0);
    expect(connections).toBe(1);
  });
}

test('a guest can retry a denied prompt from the same hearing', async ({ page, baseURL }) => {
  await voicedMicrophone(page, true);
  const session = await page.request.post('/api/auth/demo', { headers: { origin: baseURL! } });
  const { caseId } = (await session.json()).demo;
  const urls = new Set<string>();
  let frames = 0;
  await page.routeWebSocket('**/api/live/*/*/socket*', ws => {
    urls.add(ws.url());
    ws.onMessage(raw => {
      const packet = JSON.parse(String(raw));
      if (packet.type === 'stop') { ws.send(JSON.stringify({ type: 'stopped' })); return; }
      frames++;
      ws.send(JSON.stringify({ type: 'ack', id: packet.id }));
    });
    ws.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 3 }));
  });
  await page.goto('/case/' + caseId + '/hearings?new=live');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /Saya setuju/ }).check();
  await dialog.getByRole('button', { name: 'Mulai sidang', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Akses mikrofon diblokir' })).toBeVisible();
  expect(frames).toBe(0);
  const hearing = page.url();
  await page.getByRole('button', { name: 'Hubungkan mikrofon' }).click();
  await expect.poll(() => frames).toBeGreaterThan(0);
  expect(page.url()).toBe(hearing);
  expect(urls.size).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('mic-count'))).toBe('2');
  await page.getByRole('button', { name: 'Akhiri sidang', exact: true }).click();
  await page.getByRole('button', { name: 'Akhiri dan tinjau' }).click();
  await expect(page.locator('.session-control')).toHaveCount(0);
});

test('a failed hearing creation releases the microphone granted during Start', async ({ page, baseURL }) => {
  await voicedMicrophone(page);
  const session = await page.request.post('/api/auth/demo', { headers: { origin: baseURL! } });
  const { caseId } = (await session.json()).demo;
  await page.goto('/case/' + caseId + '/hearings?new=live');
  const dialog = page.getByRole('dialog');
  await page.route('**/api/cases/' + caseId + '/hearings', async route => {
    await page.waitForFunction(() => !!(window as Window & { practiceInput?: MediaStream }).practiceInput);
    await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Try again.' } } });
  });
  await dialog.getByRole('checkbox', { name: /Saya setuju/ }).check();
  await dialog.getByRole('button', { name: 'Mulai sidang', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { practiceInput?: MediaStream })
    .practiceInput?.getAudioTracks()[0]?.readyState)).toBe('ended');
});

test('a guest cannot use the practice allowance to record another private case or upload audio', async ({ page, baseURL }) => {
  const headers = { origin: baseURL! };
  await page.request.post('/api/auth/demo', { headers });
  const created = await page.request.post('/api/cases', { headers, data: { title: 'Separate private case' } });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  await page.goto('/case/' + id + '/hearings');
  await page.getByRole('button', { name: 'Sidang baru' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByRole('button', { name: /Rekam langsung/ })).toBeDisabled();
  await expect(form.getByRole('button', { name: /Unggah audio/ })).toBeDisabled();
  await expect(form.getByRole('button', { name: /Latihan kesaksian/ })).toHaveCount(0);
});
