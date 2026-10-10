import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { DELAY_RULES, NOTIFICATION_EVENTS, DEFAULT_RATE_CARD } from '@app/shared';
import { newToken } from '../src/lib/tokens.js';
import { DEFAULT_SETTINGS } from '../src/lib/settings.js';

const prisma = new PrismaClient();
const domain = process.env.GOOGLE_WORKSPACE_DOMAIN || 'example.com';

const SALES_STATUSES = [
  { key: 'no_status', label: 'New (not contacted)', order: 1 },
  { key: 'contacted_text', label: 'Contacted (text)', order: 2, requiresFollowUp: true },
  { key: 'contacted_call', label: 'Contacted (call)', order: 3, requiresFollowUp: true },
  { key: 'seems_positive', label: 'Seems positive', order: 4 },
  { key: 'transferred', label: 'Transferred', order: 5, isSystem: true, isFinal: true },
  { key: 'lost', label: 'Lost', order: 6, isFinal: true },
];
const ENGINEER_STATUSES = [
  { key: 'contacted_no_response', label: 'Contacted – no response', order: 1, requiresFollowUp: true },
  { key: 'call_later', label: 'Call later', order: 2, requiresFollowUp: true },
  { key: 'in_pipeline', label: 'In pipeline', order: 3, requiresFollowUp: true },
  { key: 'meeting_set', label: 'Meeting set', order: 4, isSystem: true },
  { key: 'asked_quote', label: 'Asked for quote', order: 5 },
  { key: 'quote_waiting_approval', label: 'Quote waiting approval', order: 6, isSystem: true },
  { key: 'quote_sent', label: 'Quote sent', order: 7, isSystem: true },
  { key: 'multiple_quotes_sent', label: 'Multiple quotes sent', order: 8, isSystem: true },
  { key: 'quote_approved_payment', label: 'Quote approved – awaiting payment', order: 9, isSystem: true },
  { key: 'pushed_to_finance', label: 'Pushed to finance', order: 10, isSystem: true },
  { key: 'advance_paid', label: 'Advance paid', order: 11, isSystem: true },
  { key: 'pushed_to_design', label: 'Pushed to design', order: 12, isSystem: true },
  { key: 'handover_complete', label: 'Handover complete', order: 13, isSystem: true, isFinal: true },
  { key: 'lost', label: 'Lost', order: 14, isFinal: true },
];
const SOURCES = ['Meta Ad', 'Instagram', 'Referral', 'Walk-in', "Don't know"];

const TEMPLATES: Array<{ channel: 'email' | 'whatsapp' | 'sms'; key: string; name: string; body: string; variables: string[] }> = [];
const t = (key: string, name: string, bodies: Partial<Record<'email' | 'whatsapp' | 'sms', string>>, variables: string[]) => { for (const [channel, body] of Object.entries(bodies)) TEMPLATES.push({ channel: channel as any, key, name, body: body!, variables }); };
t('meeting_invite', 'Meeting invitation · {{company}}', {
  email: 'Hi {{client_name}},\n\n{{company}} has scheduled a {{meeting_type}} meeting with you on {{meeting_datetime}}.\n{{meet_link}}{{office_directions}}\n\nPlease confirm here: {{invite_link}}\nRecording consent (required): {{consent_link}}\n\nThank you.',
  whatsapp: 'Hi {{client_name}}, {{company}} meeting on {{meeting_datetime}} ({{meeting_type}}). Confirm: {{invite_link}} · Consent: {{consent_link}} {{meet_link}}',
  sms: '{{company}}: meeting {{meeting_datetime}}. Confirm {{invite_link}} Consent {{consent_link}}',
}, ['client_name', 'company', 'meeting_datetime', 'meeting_type', 'meet_link', 'office_directions', 'invite_link', 'consent_link']);
t('meeting_reminder', 'Reminder: meeting {{meeting_datetime}}', { email: 'Hi {{client_name}}, reminder of your meeting with {{company}} on {{meeting_datetime}}. {{meet_link}}\nConfirm: {{invite_link}} · Consent: {{consent_link}}', whatsapp: 'Reminder: {{company}} meeting {{meeting_datetime}} {{meet_link}} Confirm {{invite_link}}', sms: '{{company}} reminder: meeting {{meeting_datetime}}' }, ['client_name', 'company', 'meeting_datetime', 'meet_link', 'invite_link', 'consent_link']);
t('meeting_rescheduled', 'Meeting rescheduled · {{company}}', { email: 'Hi {{client_name}}, your meeting with {{company}} is now on {{meeting_datetime}} ({{meeting_type}}). {{meet_link}}\nPlease re-confirm: {{invite_link}} · Consent: {{consent_link}}', whatsapp: 'Rescheduled: {{company}} meeting now {{meeting_datetime}}. Re-confirm {{invite_link}} · Consent {{consent_link}}', sms: '{{company}}: meeting moved to {{meeting_datetime}}. Confirm {{invite_link}}' }, ['client_name', 'company', 'meeting_datetime', 'meeting_type', 'meet_link', 'invite_link', 'consent_link']);
t('meeting_cancelled', 'Meeting cancelled · {{company}}', { email: 'Hi {{client_name}}, the meeting on {{meeting_datetime}} with {{company}} has been cancelled. We will reach out to reschedule.', whatsapp: '{{company}}: meeting on {{meeting_datetime}} cancelled. We will reschedule.', sms: '{{company}}: meeting {{meeting_datetime}} cancelled.' }, ['client_name', 'company', 'meeting_datetime']);
t('mom_email', 'Minutes of our meeting · {{company}}', { email: 'Hi {{client_name}},\n\nThank you for meeting us on {{meeting_datetime}}. Minutes of the meeting:\n\n{{mom_text}}\n\nIf anything is inaccurate, raise an objection here: {{mom_link}}\n\n{{company}}' }, ['client_name', 'company', 'meeting_datetime', 'mom_text', 'mom_link']);
t('quote_link', 'Your quotation from {{company}}', { email: 'Hi {{client_name}},\n\nPlease find your quotation (total ₹{{quote_total}}) here: {{quote_link}}\nYou can accept or request changes on that page.\n\n{{company}}', whatsapp: 'Hi {{client_name}}, your {{company}} quotation (₹{{quote_total}}): {{quote_link}}', sms: '{{company}} quote ₹{{quote_total}}: {{quote_link}}' }, ['client_name', 'company', 'quote_total', 'quote_link']);
t('invoice_link', 'Invoice {{invoice_number}} · {{company}}', { email: 'Hi {{client_name}},\n\nInvoice {{invoice_number}} for ₹{{amount}}: {{invoice_link}}\n\n{{company}}', sms: '{{company}} invoice {{invoice_number}} ₹{{amount}}: {{invoice_link}}' }, ['client_name', 'company', 'invoice_number', 'amount', 'invoice_link']);
t('invoice_pdf', 'Invoice {{invoice_number}}', { whatsapp: 'Invoice {{invoice_number}} for ₹{{amount}} from {{company}}. {{invoice_link}}' }, ['invoice_number', 'amount', 'company', 'invoice_link']);
t('receipt_thankyou', 'Payment received · {{company}}', { email: 'Hi {{client_name}},\n\nThank you! We received ₹{{amount}} against {{invoice_number}}. Receipt: {{receipt_link}}\n\n{{company}}', whatsapp: 'Thank you {{client_name}}! ₹{{amount}} received. Receipt: {{receipt_link}}', sms: '{{company}}: ₹{{amount}} received. Receipt {{receipt_link}}' }, ['client_name', 'company', 'amount', 'invoice_number', 'receipt_link']);

const PDF_BLOCKS: Array<[string, string, string]> = [['quote_intro', 'Quote intro', 'Thank you for considering {{company}} for your interiors. This is an indicative quotation; a detailed BOQ follows after design sign-off.'], ['invoice_footer', 'Invoice footer', 'Payment within 7 days by UPI/NEFT to the account on this invoice. Subject to Mumbai jurisdiction.'], ['receipt_footer', 'Receipt footer', 'This is a computer-generated receipt from {{company}}.']];

async function main() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) await prisma.setting.upsert({ where: { key }, create: { key, value: value as any }, update: {} });
  for (const s of SALES_STATUSES) await prisma.leadStatus.upsert({ where: { dashboard_key: { dashboard: 'sales', key: s.key } }, create: { dashboard: 'sales', ...s }, update: { label: s.label, order: s.order } });
  for (const s of ENGINEER_STATUSES) await prisma.leadStatus.upsert({ where: { dashboard_key: { dashboard: 'engineer', key: s.key } }, create: { dashboard: 'engineer', ...s }, update: { label: s.label, order: s.order } });
  for (let i = 0; i < SOURCES.length; i++) await prisma.leadSource.upsert({ where: { label: SOURCES[i] }, create: { label: SOURCES[i], order: i + 1 }, update: {} });
  for (const r of DELAY_RULES) await prisma.delayRule.upsert({ where: { dashboard_ruleKey: { dashboard: r.dashboard, ruleKey: r.ruleKey } }, create: r, update: {} });
  for (const d of ['admin', 'sales', 'engineer', 'finance', 'design_head', 'junior_designer']) for (const e of NOTIFICATION_EVENTS) await prisma.notificationRule.upsert({ where: { dashboard_eventKey: { dashboard: d, eventKey: e } }, create: { dashboard: d, eventKey: e, inApp: true, email: ['digest', 'delay_breached', 'invoice_paid'].includes(e), timingOffsetsMin: e === 'meeting_reminder' ? [1440, 60] : [] }, update: {} });
  for (const [key, name, body] of PDF_BLOCKS) await prisma.template.upsert({ where: { channel_key: { channel: 'pdf', key } }, create: { channel: 'pdf', key, name, body, variables: ['company'] }, update: {} });
  for (const tp of TEMPLATES) await prisma.template.upsert({ where: { channel_key: { channel: tp.channel, key: tp.key } }, create: { ...tp, providerStatus: tp.channel === 'whatsapp' ? 'approved' : null }, update: {} });

  const users = [
    { email: `admin@${domain}`, name: 'Asha Admin', role: 'admin' },
    { email: `sales@${domain}`, name: 'Sam Sales', role: 'sales' },
    { email: `engineer@${domain}`, name: 'Eva Engineer', role: 'engineer' },
    { email: `finance@${domain}`, name: 'Faisal Finance', role: 'finance' },
    { email: `design@${domain}`, name: 'Dev Design Head', role: 'design_head' },
    { email: `junior@${domain}`, name: 'Jia Junior', role: 'junior_designer' },
  ] as const;
  const byRole: Record<string, { id: string }> = {};
  for (const u of users) byRole[u.role] = await prisma.user.upsert({ where: { email: u.email }, create: u, update: { name: u.name, role: u.role, active: true } });
  for (const d of ['global', 'sales', 'engineer', 'finance', 'design_head', 'junior_designer'] as const) await prisma.adminPermission.upsert({ where: { adminUserId_dashboard: { adminUserId: byRole.admin.id, dashboard: d } }, create: { adminUserId: byRole.admin.id, dashboard: d, level: 'full', canApprove: true }, update: { level: 'full', canApprove: true } });

  /* demo data: a few leads at different stages */
  const noStatus = await prisma.leadStatus.findUniqueOrThrow({ where: { dashboard_key: { dashboard: 'sales', key: 'no_status' } } });
  const seemsPositive = await prisma.leadStatus.findUniqueOrThrow({ where: { dashboard_key: { dashboard: 'sales', key: 'seems_positive' } } });
  const transferred = await prisma.leadStatus.findUniqueOrThrow({ where: { dashboard_key: { dashboard: 'sales', key: 'transferred' } } });
  const inPipeline = await prisma.leadStatus.findUniqueOrThrow({ where: { dashboard_key: { dashboard: 'engineer', key: 'in_pipeline' } } });
  const demo = [
    { phone: '+919800000001', name: 'Rahul Mehta', email: 'rahul@example.org', locationArea: 'Andheri', source: 'Meta Ad', requirement: '2BHK full interiors', status: noStatus, stage: 'lead_received' as const },
    { phone: '+919800000002', name: 'Priya Nair', email: 'priya@example.org', locationArea: 'Powai', source: 'Instagram', requirement: '3BHK kitchen + wardrobes', status: seemsPositive, genuine: true, stage: 'qualified_by_sales' as const },
    { phone: '+919800000003', name: 'Arjun Shah', email: 'arjun@example.org', locationArea: 'Bandra', source: 'Referral', requirement: 'Villa renovation', status: transferred, genuine: true, stage: 'transferred_to_engineer' as const, engineer: true, exactAddress: '12 Hill Road, Bandra West, Mumbai' },
  ];
  for (const d of demo) {
    const exists = await prisma.client.findUnique({ where: { phone: d.phone } });
    if (exists) continue;
    const client = await prisma.client.create({ data: { phone: d.phone, name: d.name, email: d.email, locationArea: d.locationArea, exactAddress: d.exactAddress, addressLat: d.exactAddress ? 19.0596 : null, addressLng: d.exactAddress ? 72.8295 : null } });
    const lead = await prisma.lead.create({ data: { clientId: client.id, source: d.source, requirement: d.requirement, salesStatusId: d.status.id, genuine: !!d.genuine, salesUserId: byRole.sales.id, stage: d.stage, engineerUserId: d.engineer ? byRole.engineer.id : null, engineerStatusId: d.engineer ? inPipeline.id : null, transferredToEngineerAt: d.engineer ? new Date() : null } });
    await prisma.statusHistory.create({ data: { leadId: lead.id, dashboard: 'stage', toStatusId: 'lead_received', byUserId: byRole.sales.id } });
    await prisma.statusHistory.create({ data: { leadId: lead.id, dashboard: 'sales', toStatusId: d.status.id, byUserId: byRole.sales.id } });
    if (d.engineer) { await prisma.statusHistory.create({ data: { leadId: lead.id, dashboard: 'stage', fromStatusId: 'lead_received', toStatusId: 'transferred_to_engineer', byUserId: byRole.sales.id } }); await prisma.followUp.create({ data: { leadId: lead.id, userId: byRole.engineer.id, dueAt: new Date(Date.now() + 86400000), priority: 'high' } }); }
  }
  console.log('Seeded. Users:', users.map((u) => u.email).join(', '));
  void newToken; void DEFAULT_RATE_CARD;
}
main().finally(() => prisma.$disconnect());
