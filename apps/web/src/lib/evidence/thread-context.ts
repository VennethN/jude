import type { ContextRef, Lang, Thread, Workspace } from '@jude/core/domain';
import { evidenceKey, sourceOf } from './records';

export const contextKey = (ref: ContextRef) => ('id' in ref ? evidenceKey(ref) : ref.kind);

export function contextLabel(workspace: Workspace, ref: ContextRef, lang: Lang) {
  if ('unavailable' in ref && ref.unavailable) return lang === 'id' ? 'Sumber dihapus' : 'Source removed';
  if (ref.kind === 'case') return lang === 'id' ? 'Seluruh perkara' : 'Whole case';
  return (
    sourceOf(workspace, ref, lang)?.label ?? (lang === 'id' ? 'Sumber tidak tersedia' : 'Source unavailable')
  );
}

export function threadContexts(workspace: Workspace, thread: Thread) {
  const used = new Map<string, ContextRef>();
  const cited = new Map<string, ContextRef>();
  const citations = new Set<string>();
  for (const message of thread.messages) {
    for (const ref of message.contexts ?? []) used.set(contextKey(ref), ref);
    for (const citation of message.citations ?? []) {
      citations.add(contextKey(citation));
      if (citation.unavailable) continue;
      let ref: ContextRef = citation;
      if (citation.kind === 'passage') {
        const passage = workspace.passages.find((item) => item.id === citation.id);
        if (passage) ref = { kind: 'document', id: passage.docId };
      } else if (citation.kind === 'statement') {
        const line = workspace.statements.find((item) => item.id === citation.id);
        if (line) ref = { kind: 'hearing', id: line.hearingId };
      }
      cited.set(contextKey(ref), ref);
    }
  }
  return {
    used: [...used.values()],
    citationCount: citations.size,
    references: [...used.values(), ...[...cited].filter(([key]) => !used.has(key)).map(([, ref]) => ref)],
  };
}
