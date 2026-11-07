import { randomUUID } from 'node:crypto';
import type { Statement } from '../../domain';
import { mutateWorkspace, readWorkspace } from '../cases';
import { analyzeStatement } from './analysis';

export async function analyzeSaved(org: string, caseId: string, line: Statement) {
  const workspace = await readWorkspace(org, caseId);
  const result = await analyzeStatement(workspace, line);
  await mutateWorkspace(org, caseId, (current) => {
    const statement = current.statements.find((s) => s.id === line.id);
    if (!statement || statement.phase !== 'queued') return;
    const supported =
      result &&
      statement.text === line.text &&
      result.sources.every((source) =>
        current.passages.some(
          (p) => p.id === source.passageId && source.match && p.text.includes(source.match),
        ),
      );
    statement.phase = supported ? 'complete' : 'saved';
    if (!result || !supported || current.findings.some((f) => f.id === result.id)) return;
    current.findings.push(result);
    for (const source of result.sources) {
      if (!current.connections.some((c) => c.from.id === line.id && c.to.id === source.passageId))
        current.connections.push({
          id: randomUUID(),
          from: { kind: 'statement', id: line.id },
          to: { kind: 'passage', id: source.passageId },
          relation: source.relation,
          reviewed: false,
          basis: 'ai',
          why: result.explanation,
        });
    }
  });
}
