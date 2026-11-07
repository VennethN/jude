import { exampleCaseLabels } from '$lib/workspace/example-labels';
import { error } from '@sveltejs/kit';
import type { CaseSummary } from '@jude/core/domain';
import type { BillingAccount } from '@jude/core/plans';
import type { PageServerLoad } from './$types';

function isFull(quota: BillingAccount['usage']['cases']) {
  return typeof quota === 'object' && quota.limit !== null && quota.used >= quota.limit;
}

export const load: PageServerLoad = async ({ fetch, depends, url }) => {
  depends('jude:case-library');
  const [casesResponse, billingResponse] = await Promise.all([fetch('/api/cases'), fetch('/api/billing')]);
  if (!casesResponse.ok) error(casesResponse.status, { message: 'Gagal memuat daftar perkara.' });
  const { cases }: { cases: CaseSummary[] } = await casesResponse.json();
  const billing: BillingAccount | undefined = billingResponse.ok ? await billingResponse.json() : undefined;
  return { cases: cases.map(exampleCaseLabels), casesFull: isFull(billing?.usage.cases), storageFull: isFull(billing?.usage.storage),
    caseUnavailable: url.searchParams.get('notice') === 'case-unavailable' };
};
