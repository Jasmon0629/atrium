import { all, get, insert, now } from './db.js';
import { emitToGroup, emitToUser } from './live.js';
import { notificationShape, activityShape } from './shapes.js';

/** Insert a notification per recipient and push it to each user's personal lane. */
export async function notify(userIds, type, body, link = '', excludeUserId = null) {
  const ts = now();
  for (const uid of new Set(userIds)) {
    if (uid === excludeUserId) continue;
    const id = await insert(
      'INSERT INTO notifications (user_id, type, body, link, created_at) VALUES (?, ?, ?, ?, ?)',
      [uid, type, body, link, ts]
    );
    const row = await get('SELECT * FROM notifications WHERE id = ?', [id]);
    emitToUser(uid, 'notification.new', { notification: notificationShape(row) });
  }
}

/** Append to the group's audit trail and broadcast to its members. */
export async function logActivity(groupId, userId, verb, subject = '', detail = '') {
  const id = await insert(
    'INSERT INTO activity_logs (group_id, user_id, verb, subject, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [groupId, userId, verb, subject, detail, now()]
  );
  const row = await get('SELECT * FROM activity_logs WHERE id = ?', [id]);
  emitToGroup(groupId, 'activity.new', { activity: await activityShape(row) });
}

/** Every member id of a group (used for notification fan-out). */
export async function groupMemberIds(groupId) {
  const rows = await all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
  return rows.map((r) => r.user_id);
}
