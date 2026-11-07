import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures/practice';

async function voicedMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      sessionStorage.setItem('mic-count', String(Number(sessionStorage.getItem('mic-count') || 0) + 1));
      const audio = new AudioContext({ sampleRate: 24000 });
      const tone = audio.createOscillator();
      const outlet = audio.createMediaStreamDestination();
      tone.connect(outlet);
      tone.start();
      await audio.resume();
      return outlet.stream;
    } });
  });
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
    }
    await page.getByRole('button', { name: 'Akhiri sidang', exact: true }).click();
    await page.getByRole('button', { name: 'Akhiri dan tinjau' }).click();
    await expect(page.locator('.session-control')).toHaveCount(0);
    expect(connections).toBe(1);
  });
}

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
