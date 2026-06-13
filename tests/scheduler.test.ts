import { describe, it, expect, vi } from 'vitest';
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
  it('通知成功：弹出到点提醒后状态改为 Done', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-past', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z'),
      mkReminder('r-now', ReminderStatus.Pending, BASE_DATE),
      mkReminder('r-future', ReminderStatus.Pending, '2026-06-13T11:00:00.000Z'),
      mkReminder('r-done', ReminderStatus.Done, '2026-06-13T09:00:00.000Z'),
      mkReminder('r-ignored', ReminderStatus.Ignored, '2026-06-13T09:00:00.000Z')
    ]);
    const notifier = vi.fn().mockReturnValue(true);

    const result = processDueReminders(repo, notifier, nowMs);

    expect(result.notified.map((r) => r.id)).toEqual(['r-past', 'r-now']);
    expect(result.failed).toEqual([]);
    expect(notifier).toHaveBeenCalledTimes(2);

    expect(repo.list().find((r) => r.id === 'r-past')?.status).toBe(ReminderStatus.Done);
    expect(repo.list().find((r) => r.id === 'r-now')?.status).toBe(ReminderStatus.Done);
    expect(repo.list().find((r) => r.id === 'r-future')?.status).toBe(ReminderStatus.Pending);
  });

  it('通知失败：保留 Pending 状态且触发降级回调', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-past', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z')
    ]);
    const notifier = vi.fn().mockReturnValue(false);
    const fallback = vi.fn();

    const result = processDueReminders(repo, notifier, nowMs, fallback);

    expect(result.notified).toEqual([]);
    expect(result.failed.map((r) => r.id)).toEqual(['r-past']);
    expect(notifier).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0][0].id).toBe('r-past');
    expect(repo.list()[0].status).toBe(ReminderStatus.Pending);
  });

  it('通知失败但未传 fallback 时不崩溃，仍保留 Pending', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-past', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z')
    ]);
    const notifier = vi.fn().mockReturnValue(false);

    const result = processDueReminders(repo, notifier, nowMs);

    expect(result.failed).toHaveLength(1);
    expect(repo.list()[0].status).toBe(ReminderStatus.Pending);
  });

  it('fallback 自身抛错不影响主流程，仍保留 Pending', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-past', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z')
    ]);
    const notifier = vi.fn().mockReturnValue(false);
    const fallback = vi.fn().mockImplementation(() => {
      throw new Error('fallback boom');
    });

    expect(() => processDueReminders(repo, notifier, nowMs, fallback)).not.toThrow();
    expect(repo.list()[0].status).toBe(ReminderStatus.Pending);
  });

  it('通知不可用（模拟 Notification.isSupported=false）：不丢状态，下一轮仍可重试', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-past', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z')
    ]);
    const notifierUnavailable = vi.fn().mockReturnValue(false);

    const round1 = processDueReminders(repo, notifierUnavailable, nowMs);
    expect(round1.notified).toEqual([]);
    expect(round1.failed).toHaveLength(1);
    expect(repo.list()[0].status).toBe(ReminderStatus.Pending);

    const notifierOk = vi.fn().mockReturnValue(true);
    const round2 = processDueReminders(repo, notifierOk, nowMs + 60_000);
    expect(round2.notified.map((r) => r.id)).toEqual(['r-past']);
    expect(round2.failed).toEqual([]);
    expect(repo.list()[0].status).toBe(ReminderStatus.Done);
  });

  it('混合场景：部分成功部分失败，分别处理', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-ok', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z'),
      mkReminder('r-fail', ReminderStatus.Pending, '2026-06-13T09:30:00.000Z')
    ]);
    const notifier = vi
      .fn()
      .mockImplementation((r: Reminder) => (r.id === 'r-ok' ? true : false));
    const fallback = vi.fn();

    const result = processDueReminders(repo, notifier, nowMs, fallback);

    expect(result.notified.map((r) => r.id)).toEqual(['r-ok']);
    expect(result.failed.map((r) => r.id)).toEqual(['r-fail']);
    expect(notifier).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0][0].id).toBe('r-fail');

    expect(repo.list().find((r) => r.id === 'r-ok')?.status).toBe(ReminderStatus.Done);
    expect(repo.list().find((r) => r.id === 'r-fail')?.status).toBe(ReminderStatus.Pending);
  });

  it('成功后下一轮不再重复弹出；失败的下一轮会继续尝试', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-ok', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z'),
      mkReminder('r-fail', ReminderStatus.Pending, '2026-06-13T09:00:00.000Z')
    ]);
    const notifier = vi
      .fn()
      .mockImplementation((r: Reminder) => (r.id === 'r-ok' ? true : false));

    const first = processDueReminders(repo, notifier, nowMs);
    expect(first.notified.map((r) => r.id)).toEqual(['r-ok']);
    expect(first.failed.map((r) => r.id)).toEqual(['r-fail']);

    const second = processDueReminders(repo, notifier, nowMs + 60_000);
    expect(second.notified).toEqual([]);
    expect(second.failed.map((r) => r.id)).toEqual(['r-fail']);
    expect(notifier).toHaveBeenCalledTimes(3);
  });

  it('未来时间的 Pending 提醒不会提前触发', () => {
    const repo = new InMemoryReminderRepo([
      mkReminder('r-future', ReminderStatus.Pending, '2026-06-13T10:00:00.001Z')
    ]);
    const notifier = vi.fn().mockReturnValue(true);

    const result = processDueReminders(repo, notifier, nowMs);

    expect(result.notified).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(notifier).not.toHaveBeenCalled();
    expect(repo.list()[0].status).toBe(ReminderStatus.Pending);
  });

  it('边界：提醒时间正好等于 now 时会触发，晚 1ms 不触发', () => {
    const exactMs = nowMs;
    const repo = new InMemoryReminderRepo([
      mkReminder('r-exact', ReminderStatus.Pending, new Date(exactMs).toISOString()),
      mkReminder('r-just-after', ReminderStatus.Pending, new Date(exactMs + 1).toISOString())
    ]);
    const notifier = vi.fn().mockReturnValue(true);

    const result = processDueReminders(repo, notifier, exactMs);

    expect(result.notified.map((r) => r.id)).toEqual(['r-exact']);
    expect(result.failed).toEqual([]);
    expect(notifier).toHaveBeenCalledTimes(1);
  });

  it('空仓库时不崩溃，返回空结果', () => {
    const repo = new InMemoryReminderRepo([]);
    const notifier = vi.fn().mockReturnValue(true);

    const result = processDueReminders(repo, notifier, nowMs);

    expect(result.notified).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(notifier).not.toHaveBeenCalled();
  });
});
