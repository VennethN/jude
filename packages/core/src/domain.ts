export type Lang = "id" | "en";
/** Text shown in the interface language. Verbatim testimony and documents stay plain strings. */
export type L10n = { id: string; en: string };

export type Status =
  | "supported"
  | "potential_inconsistency"
  | "context_needed"
  | "insufficient_evidence";
export type Relation = "supports" | "conflicts" | "context" | "related";
export type Phase =
  | "queued"
  | "retrieving"
  | "analyzing"
  | "reviewing"
  | "complete"
  | "saved";

export type Role =
  | "judge"
  | "judge_member"
  /** Counsel on the user's side (the user among them). */
  | "counsel"
  /** Counsel for the opposing side, whatever it is: the state's prosecutor, the other party's lawyer. */
  | "opposing"
  | "witness"
  /** A party to the case: the defendant, a plaintiff, a respondent, an applicant. */
  | "party"
  | "unknown";

export interface Speaker {
  id: string;
  label: string;
  role: Role;
  /** Voice matches are suggestions until a person confirms the name. */
  confirmed: boolean;
  /** An unidentified voice the user assigned to a participant. */
  alias?: string;
}

export interface CaseRecord {
  id: string;
  title: string;
  reference: string;
  label: "synthetic" | "private";
  summary: L10n;
  client: string;
  court: string;
  updated: string;
  archived?: boolean;
  nextHearing?: { date: string; time: string; title: L10n };
}

export type HearingMode = "live" | "recorded" | "imported" | "scheduled";

export interface Hearing {
  id: string;
  caseId: string;
  number: number;
  title: L10n;
  date: string;
  mode: HearingMode;
  language?: Lang;
  /** Seconds of audio for recorded hearings. */
  duration?: number;
  startedAt?: string;
  endedAt?: string;
  recordingPermission?: { by: string; at: string; text: string };
  closed?: boolean;
  audio?: string;
  time?: string;
}

export interface Statement {
  id: string;
  hearingId: string;
  speakerId: string;
  /** Seconds from the start of the hearing. */
  t: number;
  text: string;
  phase?: Phase;
  legal?: string[];
  /** Bookmarked by the lawyer to look into later: kept in Temuan and on its hearing's page. */
  flagged?: boolean;
  /** The lawyer's own note on a bookmarked line. */
  note?: string;
}

/** What a suggestion rests on: a finding, a passage of a source, or the court's procedure. */
export type Basis = { kind: "finding"; id: string } | { kind: "passage"; id: string } | { kind: "procedure" };

export interface ReplySuggestion {
  /** What could be said, in the court's language. */
  text: string;
  basis: Basis;
  /** Why it is offered, in the interface's language. */
  why: L10n;
  /** How sure Jude is that it fits, from 0 to 1. */
  confidence: number;
}

/**
 * A response, from a statement's analysis: the line calls for the lawyer to answer (they are
 * called on, the other side objects to their question, the witness answers it), so Jude offers
 * one to five things they could say, the most confident first.
 */
export interface Reply {
  id: string;
  hearingId: string;
  /** The line that calls for a response. */
  statementId: string;
  /** The participant it is for: the lawyer, as they told Jude. */
  forId: string;
  reason: "called" | "objection" | "answer";
  suggestions: ReplySuggestion[];
}

export interface CaseDocument {
  id: string;
  caseId: string;
  title: string;
  kind: L10n;
  pages: number;
  file: "PDF" | "DOCX" | "TXT" | "MD";
  size: string;
  added: string;
  /** The original as a PDF for the viewer (a DOCX is shown as its converted PDF). */
  pdf?: string;
  original?: string;
  status?: "ready" | "text_unavailable";
  bytes?: number;
  /** Pages are pictures (scans, screenshots): search and citations use OCR text. */
  scanned?: boolean;
}

export interface Passage {
  ocr?: boolean;
  id: string;
  docId: string;
  page: number;
  text: string;
  before?: string;
  after?: string;
}

export interface FindingSource {
  passageId: string;
  relation: Relation;
  /** The phrase in the passage that the testimony is compared with. */
  match?: string;
}

export interface Finding {
  id: string;
  hearingId: string;
  statementId: string;
  status: Status;
  title: L10n;
  explanation: L10n;
  verify: L10n;
  uncertainty?: L10n;
  /** Suggested question in the courtroom language (Indonesian). */
  question: string;
  /** The phrase in the testimony that the finding is about. */
  said?: string;
  sources: FindingSource[];
  legal?: string[];
  reviewed: boolean;
  note: string;
  isNew?: boolean;
}

export type NodeRef = { kind: "statement" | "passage"; id: string };

export interface Connection {
  id: string;
  from: NodeRef;
  to: NodeRef;
  relation: Relation;
  reviewed: boolean;
  basis: "ai" | "semantic" | "keywords" | "manual";
  why: L10n;
}

export interface LegalRef {
  id: string;
  type: string;
  regulation: string;
  article: string;
  summary: L10n;
  keywords: string[];
}

export type InspectTarget =
  | { kind: "finding"; id: string }
  | { kind: "passage"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "connection"; id: string }
  | { kind: "legal"; id: string }
  | { kind: "reply"; id: string };

export type Citation = { kind: "passage" | "statement" | "finding" | "document" | "hearing"; id: string };

/** What a question is asked with: the whole case, a page, or a piece of the record. */
export type ContextRef =
  | { kind: "case" }
  | { kind: "documents" }
  | { kind: "hearing" | "finding" | "document" | "passage" | "statement" | "connection" | "board"; id: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: L10n | string;
  citations?: Citation[];
  legal?: string[];
  mode?: "ai" | "sources-only";
  /** On a question: every context it was asked with, kept so the history shows them. */
  contexts?: ContextRef[];
}

/** One conversation with the case assistant. */
export interface Thread {
  id: string;
  caseId: string;
  title: L10n | string;
  updated: number;
  messages: ChatMessage[];
  /** A synthetic sample conversation, labelled as such. */
  sample?: boolean;
}

export type BoardKind = "finding" | "statement" | "passage" | "document" | "excerpt";
export interface BoardRef {
  kind: BoardKind;
  id: string;
}
export interface BoardCard extends BoardRef {
  key: string;
  x: number;
  y: number;
  /** The lawyer's own note on the card. */
  note?: string;
}
export interface BoardLink {
  id: string;
  from: string;
  to: string;
  /** The kind of relationship, which sets the line's colour. */
  relation: Relation;
  /** The lawyer's own name for the relationship; empty shows the kind. */
  label: string;
  /** Where an accepted suggestion came from, so its source can be opened. */
  connectionId?: string;
  findingId?: string;
}
/** A part of a document the lawyer selected by hand. */
export interface Excerpt {
  docId: string;
  page: number;
  text: string;
  /** The recorded passage the selection falls in, if any (it links the excerpt to the evidence). */
  passageId?: string;
}
export interface Board {
  version: number;
  id: string;
  name: string;
  updated: number;
  cards: BoardCard[];
  links: BoardLink[];
  /** Suggestions set aside (a card key, or two card keys joined by "|"), so they stop coming back. */
  dismissed: string[];
  /** Whether Jude's suggestions show as silhouettes. */
  suggest: boolean;
  excerpts: Record<string, Excerpt>;
}

export type Preferences = {
  lang?: Lang;
  theme?: 'paper' | 'night' | 'system';
  density?: 'comfortable' | 'compact';
  assistantMode?: 'docked' | 'overlay';
  findingScope?: 'meaningful' | 'all';
  railCollapsed?: boolean;
  liveTextSize?: number;
  tourSeen?: boolean;
  toursDone?: string[];
};

export interface SessionInfo {
  user: { id: string; name: string; email: string; guest: boolean };
  organization: { id: string; name: string };
  role: 'owner' | 'admin' | 'member';
  prefs: Preferences;
  plan: { id: 'basic' | 'pro' | 'firm' | 'partner' };
  demo: { caseId: string; refs: Record<string, string> } | null;
}

export interface Workspace {
  version: number;
  caseRecord: CaseRecord;
  hearings: Hearing[];
  speakers: Speaker[];
  statements: Statement[];
  findings: Finding[];
  documents: CaseDocument[];
  passages: Passage[];
  connections: Connection[];
  boards: Board[];
  threads: Thread[];
  legal: LegalRef[];
  replies: Reply[];
}

export interface CaseSummary extends CaseRecord {
  counts: { hearings: number; documents: number; needsLook: number };
  live: Hearing | null;
}

export function needsReview(finding: Finding) {
  return !finding.reviewed && (finding.status === 'potential_inconsistency' || finding.status === 'context_needed');
}
