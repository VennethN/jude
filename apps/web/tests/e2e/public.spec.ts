import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('public example keeps the original record when the interface language changes', async ({page}) => {
	await page.setViewportSize({width:390,height:844});
	await page.goto('/');
	await expect(page.getByRole('heading',{level:1})).toContainText('Ikuti setiap keterangan.');
	await expect(page.locator('figure blockquote')).toContainText('setengah sepuluh malam');
	await page.getByLabel('Menu',{exact:true}).click();
	await page.locator('.mobile-links').getByRole('button',{name:/English/}).click();
	await expect(page.getByRole('heading',{level:1})).toContainText('Stay with the testimony.');
	await expect(page.locator('figure blockquote')).toContainText('setengah sepuluh malam');
	await page.locator('.desk-picker > summary').click();
	await page.getByRole('button',{name:'Access log'}).click();
	await expect(page.getByRole('blockquote').last()).toBeVisible();
	await expect(page.locator('.reading blockquote')).toContainText('20:07:41');
	await expect(page.getByRole('link',{name:'Open source in case'})).toHaveAttribute('href','/demo/documents/d3?p=d3p2');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

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
		await expect(page.getByRole('heading',{name:'Pemakaian ruang kerja'})).toBeVisible();
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
