import { prisma } from '../lib/db.js';
import { rt } from '../realtime.js';
import { enqueue } from '../jobs/queue.js';
import type { NotificationEvent } from '@app/shared';

/** In-app notification, plus email/whatsapp/sms per NotificationRule of the user's dashboard. */
export async function notify(userId: string, eventKey: NotificationEvent, title: string, body: string, link?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const rule = await prisma.notificationRule.findUnique({ where: { dashboard_eventKey: { dashboard: user.role, eventKey } } });
  if (!rule || rule.inApp) {
    const n = await prisma.notification.create({ data: { userId, eventKey, title, body, link } });
    rt.notify(userId, n);
  }
  if (rule?.email) await enqueue('send_message', { internal: true, channel: 'email', to: user.email, subject: title, body, templateKey: eventKey });
}
export async function notifyAdmins(eventKey: NotificationEvent, title: string, body: string, link?: string) {
  const admins = await prisma.user.findMany({ where: { role: 'admin', active: true } });
  for (const a of admins) await notify(a.id, eventKey, title, body, link);
}
export async function notifyRole(role: string, eventKey: NotificationEvent, title: string, body: string, link?: string) {
  const users = await prisma.user.findMany({ where: { role: role as any, active: true } });
  for (const u of users) await notify(u.id, eventKey, title, body, link);
}
