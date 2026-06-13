import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reminder } from '../shared/types/entities';
import { ReminderStatus } from '../shared/types/enums';
import { processDueReminders, ReminderRepoLike } from '../main/scheduler';

class InMemoryReminderRepo implements ReminderRepoLike {
  constructor(private reminders: Reminder[]) {}

  list(): Reminder[] {
    return this.reminders.map((r) => ({ ...r }));
  }

  updateStatus(id: string, status: ReminderStatus): void {
    const target = this.reminders.find((r) => r.id === id);
    if (target) target.status = status;
  }
}

const BASE_DATE = '2026-06-13T10:00:00.000Z';
const nowMs = new Date(BASE_DATE).getTime();

function mkReminder(
  id: string,
  status: ReminderStatus,
  remindAt: string
): Reminder {
  return {
    id,
    contactId: 'contact-1',
    content: `reminder-${id}`,
    remindAt,
    status
  };
}

describe('processDueReminders', () => {
  it('只弹出到点或已过期的 Pending 提醒，并将其状态更新为 Done', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-past', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z'),
      mkReminder('r-now', ReminderStatus.Pending, BASE_DATE),
      mkReminder('r-future', ReminderStatus.Pending, '2026-06-13T11:00:00.000Z'),
      mkReminder('r-done', ReminderStatus.Done, '2026-06-13T09:00:00.000Z'),
      mkReminder('r-ignored', ReminderStatus.Ignored, '2026-06-13T09:00:00.000Z')
    ]);
    const notifier = vi.fn();

    const processed = processDueReminders(repo, notifier, nowMs);

    expect(processed.map((r) => r.id)).toEqual(['r-past', 'r-now']);
    expect(notifier).toHaveBeenCalledTimes(2);
    expect(notifier.mock.calls[0][0].id).toBe('r-past');
    expect(notifier.mock.calls[1][0].id).toBe('r-now');

    expect(repo.list().find((r) => r.id === 'r-past')?.status).toBe(ReminderStatus.Done);
    expect(repo.list().find((r) => r.id === 'r-now')?.status).toBe(ReminderStatus.Done);
    expect(repo.list().find((r) => r.id === 'r-future')?.status).toBe(ReminderStatus.Pending);
    expect(repo.list().find((r) => r.id === 'r-done')?.status).toBe(ReminderStatus.Done);
    expect(repo.list().find((r) => r.id === 'r-ignored')?.status).toBe(ReminderStatus.Ignored);
  });

  it('未来时间的 Pending 提醒不会提前触发', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-future', ReminderStatus.Pending, '2026-06-13T10:00:00.001Z')
    ]);
    const notifier = vi.fn();

    const processed = processDueReminders(repo, notifier, nowMs);

    expect(processed).toEqual([]);
    expect(notifier).not.toHaveBeenCalled();
    expect(repo.list()[0].status).toBe(ReminderStatus.Pending);
  });

  it('下一轮调度不会重复弹出同一提醒（已转为 Done）', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-past', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z')
    ]);
    const notifier = vi.fn();

    const first = processDueReminders(repo, notifier, nowMs);
    const second = processDueReminders(repo, notifier, nowMs + 60_000);

    expect(first.map((r) => r.id)).toEqual(['r-past']);
    expect(second).toEqual([]);
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it('边界：提醒时间正好等于 now 时会触发，晚 1ms 不触发', () => {
    const exactMs = nowMs;
    const repo = new InMemoryReminderRepo([
      mkReminder('r-exact', ReminderStatus.Pending, new Date(exactMs).toISOString()),
      mkReminder('r-just-after', ReminderStatus.Pending, new Date(exactMs + 1).toISOString())
    ]);
    const notifier = vi.fn();

    const processed = processDueReminders(repo, notifier, exactMs);

    expect(processed.map((r) => r.id)).toEqual(['r-exact']);
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it('空仓库时不崩溃，返回空数组', () => {
    const repo = new InMemoryReminderRepo([]);
    const notifier = vi.fn();

    const processed = processDueReminders(repo, notifier, nowMs);

    expect(processed).toEqual([]);
    expect(notifier).not.toHaveBeenCalled();
  });
});
