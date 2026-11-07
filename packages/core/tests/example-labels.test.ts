import { describe, expect, it } from 'vitest';
import { cases, documents, speakers, statements, passages, findings } from '../src/server/seed';
import type { Workspace } from '../src/domain';
import { exampleCaseLabels, exampleWorkspaceLabels } from '../src/example-labels';
import { displayTitle, displayCourt, displaySpeaker, findingQuestion } from '../../../apps/web/src/lib/workspace/format';

const workspace: Workspace = {
  version: 1, caseRecord: cases[0], documents, speakers, statements, passages, findings,
  hearings: [], connections: [], boards: [], threads: [], legal: [], replies: [],
};
describe('synthetic interface labels', () => {
  it('translates display labels without changing any original record or evidence', () => {
    const original = structuredClone(workspace);
    const view = exampleWorkspaceLabels(workspace);
    expect(displayTitle(view.caseRecord, 'en')).toBe('Cakung Warehouse Embezzlement Case');
    expect(displayTitle(view.caseRecord, 'id')).toBe(cases[0].title);
    expect(displayCourt(view.caseRecord, 'en')).toBe('Example District Court');
    expect(displayTitle(view.documents[0], 'en')).toBe('Rina Hartati witness statement (BAP)');
    expect(view.documents[0].title).toBe(documents[0].title);
    expect(displaySpeaker(view.speakers, 'rina', 'en')).toBe('Witness Rina Hartati');
    expect(displaySpeaker(view.speakers, 'rina', 'id')).toBe('Saksi Rina Hartati');
    expect(view.caseRecord.title).toBe(cases[0].title);
    for (const finding of view.findings) {
      expect(findingQuestion(finding, 'en')).not.toBe(finding.question);
      expect(findingQuestion(finding, 'id')).toBe(finding.question);
      expect(finding.said).toBe(original.findings.find(f => f.id === finding.id)?.said);
    }
    expect(view.statements).toBe(workspace.statements);
    expect(view.passages).toBe(workspace.passages);
    expect(workspace).toEqual(original);
  });
  it('preserves private cases and renamed synthetic labels verbatim', () => {
    const privateWorkspace: Workspace = { ...workspace, caseRecord: { ...cases[0], label: 'private' } };
    expect(exampleWorkspaceLabels(privateWorkspace)).toBe(privateWorkspace);
    expect(exampleCaseLabels(privateWorkspace.caseRecord)).toBe(privateWorkspace.caseRecord);
    expect(displayTitle(exampleCaseLabels({ ...cases[0], title: 'Judul pilihan saya' }), 'en')).toBe('Judul pilihan saya');
    const renamed = exampleWorkspaceLabels({ ...workspace, speakers: [{ ...speakers[0], label: 'Nama pilihan saya' }] });
    expect(displaySpeaker(renamed.speakers, 'hk', 'en')).toBe('Nama pilihan saya');
    const authored = exampleWorkspaceLabels({ ...workspace, documents: [{ ...documents[0], id: 'uploaded' }] });
    expect(displayTitle(authored.documents[0], 'en')).toBe(documents[0].title);
    expect(displayTitle(exampleCaseLabels({ ...cases[0], title: 'Hakim Ketua' }), 'en')).toBe('Hakim Ketua');
  });
  it('translates saved and replayed sample replies while preserving their stored text', () => {
    const base = { why: findings[0].verify, confidence: 0.8 };
    const suggestions = [
      { ...base, text: findings[0].question, basis: { kind: 'finding' as const, id: findings[0].id } },
      { ...base, text: 'Mohon waktu sebentar untuk memeriksa berkas, Yang Mulia.', basis: { kind: 'procedure' as const } },
      { ...base, text: 'Catatan pilihan saya.', basis: { kind: 'procedure' as const } },
    ];
    const view = exampleWorkspaceLabels({ ...workspace, replies: [{
      id: 'reply', hearingId: 'h3', statementId: 's1', forId: 'ph', reason: 'called', suggestions,
    }] });
    const [question, procedure, authored] = view.replies[0].suggestions;
    expect(question.textTranslation?.en).toBe(findingQuestion(view.findings[0], 'en'));
    expect(procedure.textTranslation?.en).toContain('review the file');
    expect(authored.textTranslation).toBeUndefined();
    expect(view.replies[0].suggestions.map(s => s.text)).toEqual(suggestions.map(s => s.text));
  });
  it('resolves translated participant aliases and unknown voices', () => {
    const view = exampleWorkspaceLabels({ ...workspace, speakers: [...speakers, { id: 'v9', label: '', role: 'unknown', confirmed: true, alias: 'rina' }] });
    expect(displaySpeaker(view.speakers, 'v9', 'en')).toBe('Witness Rina Hartati');
    expect(displaySpeaker(view.speakers, 'v3', 'en')).toBe('Voice 3');
  });
});
