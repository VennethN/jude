<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import { localized, planById, type Language } from '@jude/core/plans';
	import type { AccountMode } from './forms.server';
	let { lang, mode, form }: { lang: Language; mode: AccountMode; form?: { ok?: boolean; error?: string; email?: string; name?: string } | null } = $props();
	const copy = {
		login: { title: localized('Masuk ke ruang kerja.', 'Sign in to your workspace.'), lead: localized('Lanjutkan pekerjaan dengan dokumen dan catatan perkara Anda.', 'Return to your case documents and working notes.'), button: localized('Masuk', 'Sign in') },
		signup: { title: localized('Buka ruang kerja Anda.', 'Open your workspace.'), lead: localized('Buat akun untuk menyimpan perkara dan menjelajahi contoh pemeriksaan saksi.', 'Create an account to keep your case files and explore an example witness examination.'), button: localized('Buat akun', 'Create account') },
		reset: { title: localized('Atur ulang kata sandi.', 'Reset your password.'), lead: localized('Masukkan email akun Anda untuk meminta tautan pengaturan ulang.', 'Enter your account email to request a reset link.'), button: localized('Kirim tautan', 'Send reset link') },
		invite: { title: localized('Gabung ke ruang kerja.', 'Join the workspace.'), lead: localized('Gunakan undangan ini untuk membuat akses ke ruang kerja tim Anda.', 'Use your invitation to create access to your team’s workspace.'), button: localized('Terima undangan', 'Accept invitation') }
	};
	const errors: Record<string, ReturnType<typeof localized>> = {
		invalid_credentials: localized('Email atau kata sandi belum sesuai. Periksa kembali keduanya.', 'The email and password do not match. Check both fields.'),
		invalid_token: localized('Tautan ini sudah kedaluwarsa atau sudah digunakan. Minta tautan baru.', 'This link has expired or has already been used. Request a new link.'),
		email_in_use: localized('Email ini sudah terdaftar. Masuk menggunakan akun Anda.', 'This email already has an account. Sign in to continue.'),
		provider_unavailable: localized('Pengiriman email belum tersedia. Hubungi pengelola ruang kerja Anda.', 'Email delivery is unavailable. Contact your workspace administrator.'),
		rate_limited: localized('Terlalu banyak percobaan. Tunggu beberapa menit lalu coba kembali.', 'Too many attempts. Wait a few minutes and try again.'),
		quota_exceeded: localized('Semua kursi tim sudah terisi. Hubungi pengelola ruang kerja.', 'All team seats are in use. Contact your workspace administrator.'),
		validation: localized('Periksa isian formulir lalu coba kembali.', 'Check the form fields and try again.'),
		request_failed: localized('Permintaan belum tersimpan. Coba kembali.', 'Your request could not be saved. Try again.')
	};
	let isId = $derived(lang === 'id');
	let hasResetToken = $derived(mode === 'reset' && Boolean(page.url.searchParams.get('token')));
	let selectedPlan = $derived(page.url.searchParams.get('plan'));
	let submitting = $state(false);
	let current = $derived(copy[mode]);
	let nextQuery = $derived.by(() => {
		const value = new URLSearchParams(page.url.search);
		value.delete('token');
		return value.size ? '?' + value.toString() : '';
	});
</script>
<svelte:head><title>{current.title[lang]} · Jude</title><meta name="robots" content="noindex"/><meta name="referrer" content="strict-origin"/></svelte:head>
<section class="account">
	<div class="sheet">
		<h1>{current.title[lang]}</h1>
		<p class="lead">{hasResetToken ? (isId ? 'Pilih kata sandi baru untuk akun Anda.' : 'Choose a new password for your account.') : current.lead[lang]}</p>
		{#if mode === 'signup' && (selectedPlan === 'pro' || selectedPlan === 'firm')}<p class="plan-note">{planById(selectedPlan).name[lang]} · {isId ? 'Uji coba 14 hari tanpa kartu.' : '14-day trial without a card.'}</p>{/if}
		{#if form?.ok && mode === 'reset'}
			<p class="pub-feedback" role="status">{hasResetToken ? (isId ? 'Kata sandi telah diubah. Anda bisa masuk kembali.' : 'Your password has been changed. You can sign in again.') : (isId ? 'Jika alamat ini terdaftar, tautan pengaturan ulang akan dikirim melalui email.' : 'If this email is registered, a password reset link will be sent.')}</p>
			<a class="pub-textlink" href="/login">{isId ? 'Kembali ke halaman masuk' : 'Back to sign in'}<Icon name="arrow"/></a>
		{:else}
			<form class="pub-form" method="POST" use:enhance={() => {
				submitting = true;
				return async ({ update }) => { try { await update({ reset: false }); } finally { submitting = false; } };
			}}>
				<input type="hidden" name="lang" value={lang}/>
				{#if form?.error}<p class="pub-feedback error" role="alert">{(errors[form.error] ?? errors.request_failed)[lang]}</p>{/if}
				{#if mode === 'signup' || mode === 'invite'}<label>{isId ? 'Nama lengkap' : 'Full name'}<input name="name" required autocomplete="name" maxlength="100" value={form?.name ?? ''}/></label>{/if}
				{#if mode !== 'invite' && !hasResetToken}<label>Email<input name="email" type="email" required autocomplete="email" maxlength="254" value={form?.email ?? ''}/></label>{/if}
				{#if mode !== 'reset' || hasResetToken}<label>{isId ? 'Kata sandi' : 'Password'}<input name="password" type="password" required minlength={mode === 'login' ? undefined : 8} maxlength="256" autocomplete={mode === 'login' ? 'current-password' : 'new-password'}/>{#if mode !== 'login'}<em>{isId ? 'Gunakan minimal 8 karakter.' : 'Use at least 8 characters.'}</em>{/if}</label>{/if}
				{#if mode === 'login'}<a class="forgot" href="/reset">{isId ? 'Lupa kata sandi?' : 'Forgot password?'}</a>{/if}
				<button class="pub-button" disabled={submitting}>{submitting ? (isId ? 'Memproses…' : 'Working…') : hasResetToken ? (isId ? 'Simpan kata sandi' : 'Save password') : current.button[lang]}<Icon name="arrow"/></button>
			</form>
			<div class="account-links">
				{#if mode === 'login'}<span>{isId ? 'Belum punya akun?' : 'New to Jude?'}</span><a href={'/signup' + nextQuery}>{isId ? 'Buat akun' : 'Create an account'}</a>
				{:else if mode === 'signup'}<span>{isId ? 'Sudah punya akun?' : 'Already have an account?'}</span><a href={'/login' + nextQuery}>{isId ? 'Masuk' : 'Sign in'}</a>
				{:else}<a href="/login">{isId ? 'Kembali ke halaman masuk' : 'Back to sign in'}</a>{/if}
			</div>
		{/if}
	</div>
</section>
<style>
	.account { display:grid; place-items:center; padding:clamp(40px,6vw,84px) 20px; min-height:calc(100svh - 188px); background:#17382c url('/public/case-cloth.webp') center/1100px; background-blend-mode:soft-light; }
	.sheet { width:min(100%,455px); padding:clamp(24px,4vw,46px); background:#f8f4e9 url('/public/ivory-paper.webp') center/640px; box-shadow:0 14px 35px #0c211a50; border-radius:3px; }
	.sheet h1 { font-size:clamp(2.6rem,4.8vw,3.65rem); }
	.lead { margin:14px 0 27px; font-size:.94rem; color:#526050; }
	.plan-note { margin:0 0 20px; font-size:.85rem; color:#4d654c; }
	.forgot { justify-self:start; color:#405941; margin-top:-10px; padding-block:7px; font-size:.85rem; }
	.account-links { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-top:22px; font-size:.86rem; }
	.account-links a { color:#35543c; font-weight:600; }
</style>
