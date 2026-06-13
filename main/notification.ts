import { Notification } from 'electron';
import { Reminder } from '../shared/types/entities';

export function showReminder(reminder: Reminder): boolean {
  try {
    if (!Notification.isSupported()) {
      console.warn('[reminder] 系统通知不可用，保持提醒为 Pending 状态');
      return false;
    }
    new Notification({ title: '内推跟进提醒', body: reminder.content }).show();
    return true;
  } catch (err) {
    console.error('[reminder] 展示提醒失败:', err);
    return false;
  }
}
