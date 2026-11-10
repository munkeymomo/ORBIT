import { orbit } from '../../store/store';
import { createBackup } from '../../lib/backup';
import { downloadText } from '../../lib/platform';

export const backupFilename = () => `orbit-backup-${new Date().toISOString().slice(0, 10)}.json`;

/** The backup file as text: ORBIT's own records and working state (never a host's records). */
export const backupJson = () => JSON.stringify(createBackup(orbit().snapshot()), null, 2);

/** Downloads a backup now. Returns the text when the download was blocked (the caller shows it to copy). */
export function downloadBackupNow(): string | null {
  const text = backupJson();
  if (!downloadText(backupFilename(), text)) return text;
  orbit().toast({ tone: 'success', text: 'Backup downloaded. Keep it somewhere safe.' });
  return null;
}
