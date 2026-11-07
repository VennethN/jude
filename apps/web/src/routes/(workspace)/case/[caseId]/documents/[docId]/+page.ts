import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params }) => {
  const { workspace } = await parent();
  const documentRecord = workspace.documents.find((d) => d.id === params.docId);
  if (!documentRecord) error(404, 'Document not found');
  return { documentId: documentRecord.id };
};
