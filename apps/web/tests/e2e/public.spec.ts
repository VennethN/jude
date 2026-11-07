import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`public illustrations switch languages and retain original source links at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const switchLanguage = async (language: 'id' | 'en') => {
      const mobile = width < 900;
      if (mobile) await page.getByLabel('Menu', { exact: true }).click();
      await page.locator(mobile ? '.mobile-links' : '.nav-right')
        .getByRole('button', { name: language === 'en' ? 'EN · English' : 'ID · Bahasa Indonesia' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
    };
    const assertIndonesian = async () => {
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Ikuti setiap keterangan.');
      await expect(page.locator('.sheet blockquote')).toContainText('setengah sepuluh malam');
      await expect(page.locator('.gather .statement-text')).toContainText('setengah sepuluh malam');
      await expect(page.locator('.p-roster')).toContainText('JADWAL JAGA GUDANG B');
      await expect(page.locator('.p-log')).toContainText('Catatan');
      await expect(page.locator('.transcript')).toContainText('Saudara saksi bekerja di mana dan sejak kapan?');
      await expect(page.locator('.page-sheet')).toContainText('BERITA ACARA PEMERIKSAAN SAKSI');
      await expect(page.locator('.page-sheet')).toContainText('Pertanyaan: Apa tugas Saudari di Gudang B?');
      await expect(page.locator('.lp')).not.toContainText('English translation');
    };
    await assertIndonesian();
    await switchLanguage('en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Stay with the testimony.');
    await expect(page.locator('.sheet blockquote')).toContainText('half past nine at night');
    await expect(page.locator('.sheet .earlier .quote')).toContainText('arrived at the warehouse shortly after 20:00 WIB');
    await expect(page.locator('.sheet .sample')).toHaveText('Synthetic example · English translation');
    await expect(page.locator('.gather .statement-text')).toContainText('half past nine at night');
    await expect(page.locator('.gather .shift')).toContainText('Mr Yusuf, the afternoon-shift security guard');
    await expect(page.locator('.gather .law')).toContainText('Article 374 of the Indonesian Criminal Code (KUHP)');
    // Translated source cards grow rather than clipping timestamps or legal references.
    for (const card of await page.locator('.source-slip .slip-text').all()) {
      expect(await card.evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
    }
    await expect(page.locator('.p-roster')).toContainText('WAREHOUSE B GUARD ROSTER');
    await expect(page.locator('.p-roster')).toContainText('20:00 WIB');
    await expect(page.locator('.p-log')).toContainText('GATE ACCESS LOG REPORT');
    await expect(page.locator('.p-log')).toContainText('White box truck');
    await expect(page.locator('.p-talk')).toContainText('HEARING 2 TRANSCRIPT');
    await expect(page.locator('.p-cctv')).toContainText('EAST GATE · WAREHOUSE B');
    await expect(page.locator('.transcript')).toContainText('Where do you work, and since when?');
    await expect(page.locator('.transcript .raised mark')).toHaveText('half past nine at night');
    await expect(page.locator('.page-sheet')).toContainText('WITNESS EXAMINATION RECORD (BAP)');
    await expect(page.locator('.page-sheet')).toContainText('Question: What are your duties at Warehouse B?');
    await expect(page.locator('.page-sheet')).toContainText('I could not clearly see who was driving');
    await expect(page.locator('.page-sheet')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.lp')).not.toContainText(/setengah sepuluh|sedikit setelah|Pertanyaan:|Jawaban:|Gudang B/);
    // Context-bearing names and legal/timezone identifiers stay intact.
    await expect(page.locator('.page-sheet')).toContainText('PRO JUSTITIA');
    await expect(page.locator('.page-sheet')).toContainText('PT Sinar Logistik Contoh');
    await expect(page.locator('.page-sheet .page-translation')).toHaveText('Synthetic example · English translation');
    await expect(page.locator('.page-sample')).toHaveAttribute('href', '/demo/documents/d1?p=d1p4');
    await page.locator('.desk-picker > summary').click();
    await page.getByRole('button', { name: 'Access log', exact: true }).click();
    await expect(page.locator('.reading blockquote')).toContainText('The access card in the name of R. Hartati');
    await expect(page.locator('.reading blockquote mark')).toHaveText('20:07:41');
    await expect(page.locator('.reading a')).toHaveText('View Indonesian original');
    await expect(page.locator('.reading a')).toHaveAttribute('href', '/demo/documents/d3?p=d3p2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Following the translated illustration opens the exact, unmodified source record.
    await page.locator('.page-sample').click();
    await expect(page).toHaveURL(/\/documents\/d1\?p=d1p4/);
    await expect(page.locator('body')).toContainText('Pada hari Sabtu tanggal 14 Maret 2026 saya tiba di gudang');
    await page.goto('/');
    await switchLanguage('id');
    await assertIndonesian();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('pricing quotes monthly and annual figures from the shared catalogue and opens contact', async ({page}) => {
	await page.goto('/pricing');
	const pro = page.locator('#plan-pro');
	await expect(pro).toContainText('Rp291.000');
	await expect(pro).toContainText('Rp3.490.000');
	await page.getByRole('link',{name:'Bulanan'}).click();
	await expect(pro).toContainText('Rp349.000');
	await expect(pro.getByRole('link')).toHaveAttribute('href','/signup?plan=pro&cycle=monthly');
	const contact = page.getByRole('link',{name:'Hubungi tim'});
	await contact.click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).not.toBeVisible();
	await expect(contact).toBeFocused();
});

test('account forms create a session and preserve a same-origin return route without JavaScript', async ({browser,baseURL}) => {
	const context = await browser.newContext({ javaScriptEnabled:false, baseURL });
	try {
		const page = await context.newPage();
		const email = 'advocate-' + randomUUID() + '@example.test';
		const secret = 'Jude-case-test-2026';
		await page.goto('/signup?next=%2Fbilling');
		await page.getByLabel('Nama lengkap').fill('Advokat Contoh');
		await page.getByLabel('Email',{exact:true}).fill(email);
		await page.getByLabel('Kata sandi',{exact:false}).fill(secret);
		await page.getByRole('button',{name:'Buat akun'}).click();
		await expect(page).toHaveURL(/\/billing$/);
		await expect(page.getByRole('heading',{name:'Paket & tagihan'})).toBeVisible();
		await expect(page.getByRole('heading',{name:'Kuota bulan ini',exact:true})).toBeVisible();
		await context.request.post('/api/auth/logout');
		await page.goto('/login?next=%2Fbilling');
		await page.getByLabel('Email',{exact:true}).fill(email);
		await page.getByLabel('Kata sandi',{exact:true}).fill(secret);
		await page.getByRole('button',{name:'Masuk',exact:true}).click();
		await expect(page).toHaveURL(/\/billing$/);
		await expect(page.locator('.current')).toContainText('Dasar');
	} finally {
		await context.close();
	}
});
