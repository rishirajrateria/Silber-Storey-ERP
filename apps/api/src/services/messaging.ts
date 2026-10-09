import { prisma } from '../lib/db.js';
import { enqueue } from '../jobs/queue.js';
import { renderTemplate } from '../lib/template.js';
import { getSetting } from '../lib/settings.js';
import { rt } from '../realtime.js';

export interface OutboundInput {
  leadId?: string; clientId?: string; channel: 'email' | 'whatsapp' | 'sms'; templateKey: string; to: string;
  vars: Record<string, string | number | undefined>; attachmentKey?: string; subject?: string; byUserId?: string;
}

/** Rule 9.16: every send → Message(queued) → worker → provider → webhook updates status. Quiet hours hold. */
export async function sendTemplated(input: OutboundInput) {
  const tpl = await prisma.template.findFirst({ where: { channel: input.channel, key: input.templateKey, active: true } });
  const company = (await getSetting<any>('branding'))?.companyName ?? '';
  const vars = { company, ...input.vars };
  const body = tpl ? renderTemplate(tpl.body, vars) : renderTemplate(`{{company}}: ${input.templateKey}`, vars);
  const subject = input.subject ?? (tpl?.name ? renderTemplate(tpl.name, vars) : undefined);
  const holdUntil = await quietHoursHold(new Date());
  const msg = await prisma.message.create({
    data: { leadId: input.leadId, clientId: input.clientId, channel: input.channel, direction: 'out', templateKey: input.templateKey, to: input.to, subject, body, attachmentKey: input.attachmentKey, byUserId: input.byUserId, status: 'queued', holdUntil },
  });
  if (input.leadId) rt.lead(input.leadId, { type: 'message', id: msg.id });
  await enqueue('send_message', { messageId: msg.id }, holdUntil ? Math.max(0, holdUntil.getTime() - Date.now()) : 0);
  return msg;
}

/** Sends the same template across email + sms + whatsapp (spec "Message×3"), skipping channels without a destination. */
export async function sendToClient3(input: Omit<OutboundInput, 'channel' | 'to'> & { client: { phone: string; email?: string | null; name?: string | null }; emailTemplateKey?: string; whatsappTemplateKey?: string; smsTemplateKey?: string }) {
  const out = [];
  if (input.client.email) out.push(await sendTemplated({ ...input, channel: 'email', to: input.client.email, templateKey: input.emailTemplateKey ?? input.templateKey }));
  out.push(await sendTemplated({ ...input, channel: 'sms', to: input.client.phone, templateKey: input.smsTemplateKey ?? input.templateKey }));
  out.push(await sendTemplated({ ...input, channel: 'whatsapp', to: input.client.phone, templateKey: input.whatsappTemplateKey ?? input.templateKey }));
  return out;
}

export async function logManualContact(leadId: string, clientId: string, channel: 'manual_call' | 'manual_whatsapp' | 'manual_email', note: string, byUserId: string, to: string) {
  const m = await prisma.message.create({ data: { leadId, clientId, channel, direction: 'manual', to, body: note, status: 'logged', byUserId, sentAt: new Date() } });
  rt.lead(leadId, { type: 'message', id: m.id });
  return m;
}

export async function quietHoursHold(now: Date): Promise<Date | null> {
  const qh = await getSetting<{ start: string; end: string } | null>('quietHours');
  if (!qh?.start || !qh?.end) return null;
  const [sh, sm] = qh.start.split(':').map(Number), [eh, em] = qh.end.split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes(), s = sh * 60 + sm, e = eh * 60 + em;
  const inQuiet = s < e ? mins >= s && mins < e : mins >= s || mins < e;
  if (!inQuiet) return null;
  const release = new Date(now); release.setHours(eh, em, 0, 0);
  if (release <= now) release.setDate(release.getDate() + 1);
  return release;
}
