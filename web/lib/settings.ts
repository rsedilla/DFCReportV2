import { authenticatedRequest } from '@/lib/session';

/** The Admin's Settings tab (SKILL.md section 7, decision 0425). */
export interface ChurchSettings {
  cell_attention_months: number;
  initial_encoding_open: boolean;
  /** The first Sunday the DCC calendar covers; shown, never changed here. */
  dcc_calendar_start: string | null;
  /** The last Sunday the DCC calendar has been generated to. */
  dcc_calendar_through: string | null;
  /** The verse under Record's welcome; both null where none is shown. */
  record_verse: RecordVerse;
}

/** The verse an administrator sets for Record (decision 0425). */
export interface RecordVerse {
  text: string | null;
  reference: string | null;
}

/** Any signed-in account reads it, because Record shows it to everyone. */
export function getRecordVerse(signal?: AbortSignal): Promise<RecordVerse> {
  return authenticatedRequest<RecordVerse>('/api/v1/settings/record-verse', { signal });
}

export function setRecordVerse(verse: RecordVerse, idempotencyKey: string): Promise<ChurchSettings> {
  return authenticatedRequest<ChurchSettings>('/api/v1/settings/record-verse', {
    method: 'PUT',
    body: verse,
    idempotencyKey,
  });
}

export function getSettings(signal?: AbortSignal): Promise<ChurchSettings> {
  return authenticatedRequest<ChurchSettings>('/api/v1/settings', { signal });
}

export function setCellAttentionMonths(
  months: number,
  idempotencyKey: string,
): Promise<ChurchSettings> {
  return authenticatedRequest<ChurchSettings>('/api/v1/settings/cell-attention-months', {
    method: 'PATCH',
    body: { months },
    idempotencyKey,
  });
}

export function closeInitialEncoding(idempotencyKey: string): Promise<ChurchSettings> {
  return authenticatedRequest<ChurchSettings>('/api/v1/settings/initial-encoding/close', {
    method: 'POST',
    body: {},
    idempotencyKey,
  });
}
