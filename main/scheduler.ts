import { Reminder } from '../shared/types/entities';
import { ReminderStatus } from '../shared/types/enums';
import { showReminder } from './notification';
import { ReminderRepository } from './repositories/reminder';

export interface ReminderRepoLike {
  list: () => Reminder[];
  updateStatus: (id: string, status: ReminderStatus) => void;
}

export function processDueReminders(
  repo: ReminderRepoLike,
  notifier: (reminder: Reminder) => void,
  nowMs: number
): Reminder[] {
  const due = repo
    .list()
    .filter(
      (item) =>
        item.status === ReminderStatus.Pending &&
        new Date(item.remindAt).getTime() <= nowMs
    );

  for (const item of due) {
    notifier(item);
    repo.updateStatus(item.id, ReminderStatus.Done);
  }

  return due;
}

export function startReminderScheduler() {
  const repo = new ReminderRepository();
  setInterval(() => {
    processDueReminders(repo, showReminder, Date.now());
  }, 60_000);
}
