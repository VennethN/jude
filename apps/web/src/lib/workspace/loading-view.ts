import type { NavigationTarget } from '@sveltejs/kit';

export const loadingTitles = {
  cases: ['Perkara Anda', 'Your cases'],
  overview: ['Ringkasan perkara', 'Case overview'],
  hearings: ['Sidang', 'Hearings'],
  hearing: ['Catatan sidang', 'Hearing record'],
  documents: ['Dokumen', 'Documents'],
  document: ['Dokumen perkara', 'Case document'],
  findings: ['Temuan', 'Findings'],
  finding: ['Temuan', 'Finding'],
  board: ['Papan temuan', 'Case board'],
  assistant: ['Asisten', 'Assistant'],
  thread: ['Percakapan', 'Conversation'],
  connections: ['Keterkaitan', 'Connections']
} as const;

export type LoadingView = keyof typeof loadingTitles;

export function loadingView(target: NavigationTarget | null): LoadingView | undefined {
  switch (target?.route.id) {
    case '/(workspace)/cases': return 'cases';
    case '/(workspace)/case/[caseId]': return 'overview';
    case '/(workspace)/case/[caseId]/hearings': return 'hearings';
    case '/(workspace)/case/[caseId]/hearings/[hearingId]': return 'hearing';
    case '/(workspace)/case/[caseId]/documents': return 'documents';
    case '/(workspace)/case/[caseId]/documents/[docId]': return 'document';
    case '/(workspace)/case/[caseId]/findings/[[findingId]]':
      if (target.url.searchParams.get('view') === 'board') return 'board';
      return target.params?.findingId ? 'finding' : 'findings';
    case '/(workspace)/case/[caseId]/assistant/[[threadId]]':
      return target.params?.threadId ? 'thread' : 'assistant';
    case '/(workspace)/case/[caseId]/connections': return 'connections';
  }
}
