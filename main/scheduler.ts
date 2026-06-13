import { Reminder } from '../shared/types/entities';
import { ReminderStatus } from '../shared/types/enums';
import { showReminder } from './notification';
import { ReminderRepository } from './repositories/reminder';

export interface ReminderRepoLike {
  list: () => Reminder[];
  updateStatus: (id: string, status: ReminderStatus) => void;
}

export interface ProcessResult {
  notified: Reminder[];
  failed: Reminder[];
}

export function processDueReminders(
  repo: ReminderRepoLike,
  notifier: (reminder: Reminder) => boolean,
  nowMs: number,
  fallback?: (reminder: Reminder) => void
): ProcessResult {
  const due = repo
    .list()
    .filter(
      (item) =>
        item.status === ReminderStatus.Pending &&
        new Date(item.remindAt).getTime() <= nowMs
    );

  const notified: Reminder[] = [];
  const failed: Reminder[] = [];

  for (const item of due) {
    const ok = notifier(item);
    if (ok) {
      repo.updateStatus(item.id, ReminderStatus.Done);
      notified.push(item);
    } else {
      if (fallback) {
        try {
          fallback(item);
        } catch (err) {
          console.error('[reminder] 降级提示执行失败:', err);
        }
      }
      failed.push(item);
    }
  }

  return { notified, failed };
}

export function startReminderScheduler() {
  const repo = new ReminderRepository();
  setInterval(() => {
    processDueReminders(repo, showReminder, Date.now(), (reminder) => {
      console.log(`[reminder] 降级提示：${reminder.content}（${new Date(reminder.remindAt).toLocaleString()}）`);
    });
  }, 60_000);
}
