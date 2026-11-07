<script lang="ts">
	import AccountForm from '$lib/public/AccountForm.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>
<AccountForm lang={data.lang} mode="reset" {form}/>
