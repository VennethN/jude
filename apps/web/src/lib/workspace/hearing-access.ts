import { isGuestPractice, type CaseRecord, type SessionInfo } from '@jude/core/domain';

export function canStartHearing(account: SessionInfo, record: CaseRecord, transcription: boolean) {
  return record.label === 'synthetic' || (transcription && (
    isGuestPractice(account, record) || (!account.user.guest && account.plan.id !== 'basic')
  ));
}
