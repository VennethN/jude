import { describe, expect, it } from 'vitest';
import { cases, documents, speakers, statements, passages } from '../src/server/seed';
import type { Workspace } from '../src/domain';
import { exampleCaseLabels, exampleWorkspaceLabels } from '../../../apps/web/src/lib/workspace/example-labels';
import { displayTitle, displayCourt, displaySpeaker } from '../../../apps/web/src/lib/workspace/format';

const workspace: Workspace = {
  version: 1, caseRecord: cases[0], documents, speakers, statements, passages,
  hearings: [], findings: [], connections: [], boards: [], threads: [], legal: [], replies: [],
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
  });
  it('resolves translated participant aliases and unknown voices', () => {
    const view = exampleWorkspaceLabels({ ...workspace, speakers: [...speakers, { id: 'v9', label: '', role: 'unknown', confirmed: true, alias: 'rina' }] });
    expect(displaySpeaker(view.speakers, 'v9', 'en')).toBe('Witness Rina Hartati');
    expect(displaySpeaker(view.speakers, 'v3', 'en')).toBe('Voice 3');
  });
});
