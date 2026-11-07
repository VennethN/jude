import { expect, test, type Locator } from '@playwright/test';

async function scrub(scene: Locator, progress: number) {
	await scene.evaluate((node, progress) => {
		const rect = node.getBoundingClientRect();
		window.scrollBy(0, rect.top + Math.max(0, node.clientHeight - innerHeight) * progress);
	}, progress);
}

test('source scenes follow native scrolling in both directions and section history works', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/');
	await expect(page.locator('.lp')).toHaveClass(/pinned/);
	expect(await page.locator('.gavel').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
	await page.getByRole('link', { name: 'Lihat cara kerjanya' }).click();
	await expect(page).toHaveURL(/#lp-how$/);
	await page.getByRole('link', { name: 'Berbasis bukti' }).first().click();
	await expect(page).toHaveURL(/#lp-source$/);
	await page.goBack();
	await expect(page).toHaveURL(/#lp-how$/);
	await page.goForward();
	await expect(page).toHaveURL(/#lp-source$/);
	for (const [name, track] of [['gather','--g4'],['show','--th'],['how','--h3'],['signal','--mk'],['page','--hl']]) {
		const scene = page.locator('[data-scene="'+name+'"]');
		for (const progress of [.03,.94,.03]) {
			await scrub(scene, progress);
			await expect.poll(() => scene.evaluate((node,track) => node.style.getPropertyValue(track),track)).toBe(progress > .5 ? '1.000' : '0.000');
		}
	}

	// Four exhibits are filed over 280vh. Inspect the actual moving fourth slip
	// at quarter, half and three-quarter travel, then trace it backwards.
	const gather=page.locator('[data-scene="gather"]');
	expect(await gather.evaluate(n=>n.clientHeight/innerHeight)).toBeGreaterThan(2.7);
	const positions:number[]=[];
	for (const [at,want] of [[.64,.156],[.68,.5],[.72,.844],[.68,.5],[.64,.156]]) {
		await scrub(gather,at);
		await expect.poll(() => gather.evaluate(n=>Number(n.style.getPropertyValue('--g4')))).toBeCloseTo(want,1);
		positions.push(await gather.locator('.source-slip.law').evaluate(n => new DOMMatrix(getComputedStyle(n).transform).m41));
	}
	expect(positions[1]-positions[0]).toBeGreaterThan(60);
	expect(positions[2]-positions[1]).toBeGreaterThan(60);
	expect(positions[1]).toBeCloseTo(positions[3],1);
	expect(positions[0]).toBeCloseTo(positions[4],1);
	const how=page.locator('[data-scene="how"]');
	const rule=how.locator('.step-rule span');
	await expect(rule).toBeVisible();
	for(const at of [.25,.5,.75,.5]) {
		await scrub(how,at);
		await expect.poll(()=>rule.evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a)).toBeCloseTo(at,1);
	}
	const before = await page.evaluate(() => scrollY);
	await page.mouse.move(1120,610);
	await page.mouse.wheel(0,545);
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before+100);
});

test('source controls and the clay layout work on phones, short screens and reduced motion', async ({ page }) => {
	for (const size of [{width:390,height:844},{width:1280,height:550},{width:1280,height:850}]) {
		const reduced = size.height === 850;
		await page.setViewportSize(size);
		await page.emulateMedia({ reducedMotion:reduced ? 'reduce' : 'no-preference' });
		await page.goto('/#lp-source');
		const story=page.locator('.lp');
		await expect(story).not.toHaveClass(/pinned/);
		if (reduced) {
			await expect(story).not.toHaveClass(/scrolly/);
			await expect(page.getByRole('button',{name:'Putar ulang perbandingan'})).toHaveCount(0);
		}
		const choices=page.locator('.desk-tabs button');
		await expect(choices.first()).toBeEnabled();
		await choices.first().focus();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('End');
		await expect(choices.last()).toBeFocused();
		await expect(choices.last()).toHaveAttribute('aria-pressed','true');
		await expect(page.locator('.excerpt blockquote')).toContainText('20:07:41');
		await expect(page.getByRole('link',{name:'Buka sumber dalam perkara'})).toHaveAttribute('href','/demo/documents/d3?p=d3p2');
		await page.keyboard.press('Home');
		await expect(choices.first()).toBeFocused();
		await expect(page.locator('.excerpt blockquote')).toContainText('setengah sepuluh malam');
		const layout = await page.evaluate(() => {
			const rect = (selector:string) => document.querySelector(selector)!.getBoundingClientRect();
			const overlap = (a:DOMRect,b:DOMRect) => a.width>0 && a.height>0 && a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
			const heading = rect('.show-head');
			const picker = rect('.desk-picker');
			return { overflow:document.documentElement.scrollWidth>innerWidth, heading:overlap(rect('.gavel'),rect('.lead')), buttons:[...document.querySelectorAll('.opening .actions a')].some(link=>overlap(rect('.gavel'),link.getBoundingClientRect())), order:Math.round(heading.bottom)<=Math.ceil(picker.top)};
		});
		expect(layout).toEqual({overflow:false,heading:false,buttons:false,order:true});
	}
});

test('the public comparison links work without JavaScript', async ({ browser, baseURL }) => {
	const context = await browser.newContext({baseURL,javaScriptEnabled:false});
	try {
		const page=await context.newPage();
		await page.goto('/');
		await expect(page.locator('.sheet blockquote')).toContainText('setengah sepuluh malam');
		await expect(page.locator('.sheet a.source').last()).toHaveAttribute('href','/demo/documents/d1?p=d1p4');
		await expect(page.getByRole('link',{name:'Lihat cara kerjanya'})).toHaveAttribute('href','#lp-how');
		await expect(page.locator('.desk-picker .direct-sources a')).toHaveCount(3);
	} finally {await context.close();}
});
