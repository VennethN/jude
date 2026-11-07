import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
  const { workspace } = await parent();
  const documentRecord = workspace.documents.find((d) => d.id === params.docId);
  if (!documentRecord) error(404, 'Document not found');
  return { documentId: documentRecord.id };
};
