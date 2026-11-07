import { expect } from '@playwright/test';
import { test } from './fixtures/practice';

for (const width of [1440, 390]) test(`ending a hearing retries saved audio without restarting the microphone at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    const state = { requests: 0, stream: undefined as MediaStream | undefined };
    Object.assign(window, { hearingMic: state });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      state.requests++;
      const audio = new AudioContext({ sampleRate: 24000 });
      const oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start(); await audio.resume();
      state.stream = destination.stream;
      return destination.stream;
    } });
  });
  await page.goto('/login');
  const origin = new URL(page.url()).origin;
  async function post(path: string, data: object) {
    const response = await page.request.post('/api/' + path, { data, headers: { origin } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('auth/signup', { name: 'Synthetic stop test', email: `stop-${width}-${Date.now()}@example.test`, password: 'Synthetic-stop-test-2468!' });
  await post('billing/plan', { planId: 'firm', cycle: 'monthly' });
  const record = await post('cases', { title: 'Synthetic recording recovery' });
  const hearing = await post(`cases/${record.id}/hearings`, { flow: 'live', date: '2026-11-07', title: 'Synthetic microphone stop', language: 'id', closed: false, recordingPermission: true });
  let connections = 0, received = 0;
  let rejectDrain: (() => void) | undefined;
  await page.routeWebSocket(`**/api/live/${record.id}/${hearing.id}/socket*`, socket => {
    const attempt = ++connections;
    socket.onMessage(raw => {
      const packet = JSON.parse(String(raw));
      if (packet.type === 'stop') {
        if (attempt === 1) rejectDrain = () => socket.send(JSON.stringify({ type: 'error', code: 'validation' }));
        else socket.send(JSON.stringify({ type: 'stopped' }));
      } else {
        received++;
        socket.send(JSON.stringify({ type: attempt === 1 ? 'accepted' : 'ack', id: packet.id }));
      }
    });
    socket.send(JSON.stringify({ type: 'ready', protocol: 2, maxInFlight: 3 }));
  });
  await page.goto(`/case/${record.id}/hearings/${hearing.id}`);
  await page.getByRole('button', { name: 'Hubungkan mikrofon', exact: true }).click();
  await expect.poll(() => received).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Akhiri sidang', exact: true }).click();
  await page.getByRole('button', { name: 'Akhiri dan tinjau', exact: true }).click();
  await expect.poll(() => !!rejectDrain).toBe(true);
  await expect(page.getByRole('dialog')).toContainText('Mikrofon sudah mati');
  expect(await page.evaluate(() => (window as unknown as { hearingMic: { stream: MediaStream } }).hearingMic.stream.getTracks().map(t => t.readyState))).toEqual(['ended']);
  const timer = page.locator('.session-label > span').last();
  const frozen = await timer.textContent(), count = received;
  await page.waitForTimeout(1300);
  await expect(timer).toHaveText(frozen!);
  expect(received).toBe(count);
  await page.screenshot({ path: info.outputPath('stopped-saving.png'), fullPage: true });
  rejectDrain!();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('tanpa menyalakan mikrofon');
  await expect(page.getByRole('button', { name: 'Coba kirim lagi' })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Coba kirim lagi' })).toBeVisible();
  await expect(timer).toHaveText(frozen!);
  await expect(page.getByRole('button', { name: 'Hubungkan mikrofon' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('retry-without-microphone.png'), fullPage: true });
  await page.getByRole('button', { name: 'Coba kirim lagi' }).click();
  await expect.poll(async () => {
    const workspace = await (await page.request.get(`/api/cases/${record.id}/workspace`)).json();
    return workspace.hearings.find((h: { id: string }) => h.id === hearing.id).mode;
  }).toBe('recorded');
  expect(await page.evaluate(() => (window as unknown as { hearingMic: { requests: number } }).hearingMic.requests)).toBe(0);
  await expect(page.locator('.session-control')).toHaveCount(0);
});
