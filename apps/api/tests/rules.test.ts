import { describe, it, expect, beforeAll } from 'vitest';
import { api, pub, getApp, resetData, prisma, statusId, sourceId, userId, iso } from './helpers.js';

const sales = api('sales'), eng = api('engineer'), fin = api('finance'), adm = api('admin'), head = api('design_head'), jr = api('junior_designer');
let phoneSeq = 100;
const phone = () => `+91970000${String(phoneSeq++).padStart(4, '0')}`;

async function newLead(extra: Record<string, unknown> = {}) {
  const r = await sales.post('/leads', { phone: phone(), name: 'Test Client', email: 'client@example.org', sourceId: await sourceId(), ...extra });
  expect(r.status).toBe(201);
  return r.data;
}
async function qualify(leadId: string) {
  await sales.post(`/leads/${leadId}/genuine`, { genuine: true });
  const r = await sales.post(`/leads/${leadId}/status`, { statusId: await statusId('sales', 'seems_positive') });
  expect(r.status).toBe(200);
}
async function transferred() {
  const lead = await newLead();
  await qualify(lead.id);
  const r = await sales.post(`/leads/${lead.id}/transfer-to-engineer`, {});
  expect(r.status).toBe(200);
  await eng.patch(`/leads/${lead.id}`, { exactAddress: '12 Hill Road, Bandra' });
  return lead;
}
async function completedMeeting(leadId: string, type: 'meet' | 'site' = 'meet') {
  const m = (await eng.post('/meetings', { leadId, kind: 'client', type, startAt: iso(5), endAt: iso(65), adminInvited: false })).data;
  await pub.call('POST', `/p/invite/${m.inviteToken}/accept`);
  await pub.call('POST', `/p/consent/${m.consentToken}/accept`);
  const init = (await eng.post(`/meetings/${m.id}/recording/init`)).data;
  const app = await getApp();
  await app.inject({ method: 'PUT', url: `/api/v1/meetings/${m.id}/recording/chunk/0?uploadId=${init.uploadId}`, payload: Buffer.from('audio-bytes'), headers: { 'content-type': 'application/octet-stream' }, cookies: { sid: (await import('./helpers.js')).login && (await (await import('./helpers.js')).login('engineer')) } });
  await eng.post(`/meetings/${m.id}/recording/complete`, { uploadId: init.uploadId, chunks: 1 });
  const c = await eng.post(`/meetings/${m.id}/complete`);
  expect(c.status).toBe(200);
  return m;
}
const quoteData = { propertyType: '2BHK', carpetAreaSqft: 800, locality: 'Powai', possession: 'ready', projectType: 'full', package: 'premium', rooms: [{ name: 'Kitchen', items: [{ key: 'modular_kitchen', label: 'Modular kitchen', qty: 10, unit: 'rft', rate: 1800, rateOverridden: false }] }], services: [{ key: 'design_fee', label: 'Design fee', mode: 'pct', value: 8 }], contingencyPct: 5, discountType: 'amount', discountValue: 1000, roundOff: true };
const schedule = [{ name: 'Advance', pct: 40, trigger: 'on acceptance' }, { name: 'Mid', pct: 40, trigger: 'on site start' }, { name: 'Final', pct: 20, trigger: 'on completion' }];
async function approveAll(type?: string) {
  const list = (await adm.get('/approvals?status=pending')).data as any[];
  for (const a of list.filter((x) => !type || x.type === type)) { const r = await adm.post(`/approvals/${a.id}/decide`, { approve: true, remark: 'ok' }); expect(r.status).toBe(200); }
}
async function acceptedFinalQuote(leadId: string) {
  const v = (await eng.post(`/leads/${leadId}/quote/versions`, { data: quoteData, paymentSchedule: schedule, isFinal: true })).data;
  await approveAll('quote_version');
  expect((await eng.post(`/quote-versions/${v.id}/send`)).status).toBe(200);
  expect((await pub.call('POST', `/p/quote/${v.clientToken}/accept`)).status).toBe(200);
  await eng.put(`/leads/${leadId}/billing`, { legalName: 'Test Client', billingAddress: '1 Road', state: 'Maharashtra', siteAddress: '12 Hill Road', contactName: 'Test', contactPhone: '+919700000001', contactEmail: 'client@example.org' });
  return v;
}
async function advancePaid(leadId: string) {
  await acceptedFinalQuote(leadId);
  expect((await eng.post(`/leads/${leadId}/push-to-finance`)).status).toBe(200);
  const p = (await fin.get(`/leads/${leadId}/pipeline`)).data;
  const inv = (await fin.post(`/milestones/${p.milestones[0].id}/invoice`)).data;
  const sent = (await fin.post(`/invoices/${inv.id}/send`)).data;
  const pay = await fin.post(`/invoices/${inv.id}/payments`, { amount: sent.total, mode: 'upi', reference: 'UPI1', paidOn: new Date().toISOString() });
  expect(pay.status).toBe(201);
  return sent;
}

beforeAll(async () => { await getApp(); await resetData(); }, 120000);

describe('9.1 duplicate', () => {
  it('409 DUPLICATE with existing summary; override approval creates lead with previousLeadId', async () => {
    const lead = await newLead();
    const dup = await sales.post('/leads', { phone: lead.client.phone, sourceId: await sourceId() });
    expect(dup.status).toBe(409); expect(dup.error.code).toBe('DUPLICATE'); expect(dup.error.details.existingClient.leadCount).toBe(1);
    const req = await sales.post('/leads/duplicate-override', { phone: lead.client.phone, name: 'Again', sourceId: await sourceId() });
    expect(req.status).toBe(200);
    await approveAll('duplicate_override');
    const leads = await prisma.lead.findMany({ where: { clientId: lead.clientId }, orderBy: { createdAt: 'asc' } });
    expect(leads).toHaveLength(2); expect(leads[1].previousLeadId).toBe(lead.id);
  });
});

describe('9.2 transfer', () => {
  it('blocked unless seems_positive + genuine; after transfer sales is read-only; engineer cannot change sales status', async () => {
    const lead = await newLead();
    expect((await sales.post(`/leads/${lead.id}/transfer-to-engineer`, {})).error.code).toBe('TRANSFER_BLOCKED');
    await sales.post(`/leads/${lead.id}/status`, { statusId: await statusId('sales', 'seems_positive') });
    expect((await sales.post(`/leads/${lead.id}/transfer-to-engineer`, {})).error.code).toBe('TRANSFER_BLOCKED');
    await sales.post(`/leads/${lead.id}/genuine`, { genuine: true });
    const t = await sales.post(`/leads/${lead.id}/transfer-to-engineer`, {});
    expect(t.status).toBe(200); expect(t.data.stage).toBe('transferred_to_engineer'); expect(t.data.salesStatus.key).toBe('transferred');
    expect((await sales.patch(`/leads/${lead.id}`, { name: 'x' })).status).toBe(403);
    expect((await sales.post(`/leads/${lead.id}/status`, { statusId: await statusId('sales', 'contacted_call') })).status).toBe(403);
    expect((await eng.post(`/leads/${lead.id}/status`, { statusId: await statusId('sales', 'lost'), reason: 'x' })).status).toBe(403);
  });
});

describe('9.3 status change', () => {
  it('requiresFollowUp needs date+priority and creates FollowUp; lost needs reason; system statuses blocked', async () => {
    const lead = await newLead();
    const r1 = await sales.post(`/leads/${lead.id}/status`, { statusId: await statusId('sales', 'contacted_call') });
    expect(r1.status).toBe(400);
    const r2 = await sales.post(`/leads/${lead.id}/status`, { statusId: await statusId('sales', 'contacted_call'), followUpAt: iso(120), priority: 'high' });
    expect(r2.status).toBe(200);
    expect(await prisma.followUp.count({ where: { leadId: lead.id } })).toBe(1);
    expect((await sales.post(`/leads/${lead.id}/status`, { statusId: await statusId('sales', 'lost') })).status).toBe(400);
    expect((await sales.post(`/leads/${lead.id}/status`, { statusId: await statusId('sales', 'transferred') })).error.code).toBe('SYSTEM_STATUS');
    const hist = await prisma.statusHistory.findMany({ where: { leadId: lead.id, dashboard: 'sales' } });
    expect(hist.length).toBeGreaterThanOrEqual(2);
  });
});

describe('9.4 / 9.5 / 9.6 meetings', () => {
  it('start needs invite + consent (+ check-in for site); check-in needs travel + radius; complete needs recording', async () => {
    const lead = await transferred();
    const m = (await eng.post('/meetings', { leadId: lead.id, kind: 'client', type: 'site', startAt: iso(5), endAt: iso(65), adminInvited: true })).data;
    expect(m.inviteToken).toBeTruthy();
    expect((await eng.post(`/meetings/${m.id}/start`)).error.code).toBe('INVITE_PENDING');
    expect((await pub.call('POST', `/p/invite/${m.inviteToken}/accept`)).status).toBe(200);
    expect((await eng.post(`/meetings/${m.id}/start`)).error.code).toBe('CONSENT_PENDING');
    await pub.call('POST', `/p/consent/${m.consentToken}/accept`);
    expect((await eng.post(`/meetings/${m.id}/start`)).error.code).toBe('CHECKIN_REQUIRED');
    const client = await prisma.client.findUniqueOrThrow({ where: { id: lead.clientId } });
    expect((await eng.post(`/meetings/${m.id}/checkin`, { lat: client.addressLat, lng: client.addressLng })).error.code).toBe('TRAVEL_NOT_STARTED');
    await eng.post(`/meetings/${m.id}/travel-start`);
    const far = await eng.post(`/meetings/${m.id}/checkin`, { lat: client.addressLat! + 0.01, lng: client.addressLng! });
    expect(far.error.code).toBe('OUT_OF_RANGE'); expect(far.error.details.distanceM).toBeGreaterThan(200);
    expect((await eng.post(`/meetings/${m.id}/checkin`, { lat: client.addressLat! + 0.0005, lng: client.addressLng! })).status).toBe(200);
    expect((await eng.post(`/meetings/${m.id}/start`)).status).toBe(200);
    expect((await eng.post(`/meetings/${m.id}/complete`)).error.code).toBe('RECORDING_MISSING');
    // admin invite approval exists
    const inv = (await adm.get('/approvals?status=pending')).data.find((a: any) => a.type === 'meeting_invite' && a.entityId === m.id);
    expect(inv).toBeTruthy();
    await adm.post(`/meetings/${m.id}/admin-respond`, { accept: false, remark: 'busy', decision: 'proceed' });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } })).adminResponse).toBe('declined');
    // messages ×3 were queued/sent for the invite
    const msgs = await prisma.message.findMany({ where: { leadId: lead.id, templateKey: 'meeting_invite' } });
    expect(msgs.map((x) => x.channel).sort()).toEqual(['email', 'sms', 'whatsapp']);
    expect(msgs.every((x) => x.status === 'sent')).toBe(true);
  });
  it('complete with recording → stage meeting_done, transcript + MoM created (immutable), MoM emailed with objection link', async () => {
    const lead = await transferred();
    const m = await completedMeeting(lead.id);
    const full = await prisma.meeting.findUniqueOrThrow({ where: { id: m.id }, include: { transcript: true, mom: true } });
    expect(full.status).toBe('completed'); expect(full.transcript).toBeTruthy(); expect(full.mom).toBeTruthy();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe('meeting_done');
    await expect(prisma.transcript.update({ where: { meetingId: m.id }, data: { text: 'edited' } })).rejects.toThrow();
    await expect(prisma.minutesOfMeeting.delete({ where: { meetingId: m.id } })).rejects.toThrow();
    const momMail = await prisma.message.findFirst({ where: { leadId: lead.id, templateKey: 'mom_email' } });
    expect(momMail?.channel).toBe('email'); expect(momMail?.body).toContain('/p/mom/');
    const obj = await pub.call('POST', `/p/mom/${full.mom!.token}/objection`, { remark: 'Budget was 10 lakh' });
    expect(obj.status).toBe(200);
    expect(await prisma.documentChunk.count({ where: { leadId: lead.id } })).toBeGreaterThan(0);
  });
  it('9.16 reschedule invalidates tokens and re-sends', async () => {
    const lead = await transferred();
    const m = (await eng.post('/meetings', { leadId: lead.id, kind: 'client', type: 'meet', startAt: iso(60), endAt: iso(120), adminInvited: false })).data;
    const r = (await eng.patch(`/meetings/${m.id}/reschedule`, { startAt: iso(180), endAt: iso(240) })).data;
    expect(r.inviteToken).not.toBe(m.inviteToken); expect(r.status).toBe('rescheduled');
    expect((await pub.call('GET', `/p/invite/${m.inviteToken}`)).status).toBe(404);
    expect((await pub.call('GET', `/p/invite/${r.inviteToken}`)).status).toBe(200);
    expect(await prisma.message.count({ where: { leadId: lead.id, templateKey: 'meeting_rescheduled' } })).toBe(3);
  });
});

describe('9.7 quotes', () => {
  it('v1 requires approval; send blocked until approved; statuses quote_waiting_approval → quote_sent → multiple_quotes_sent; versions immutable', async () => {
    const lead = await transferred();
    const v1 = (await eng.post(`/leads/${lead.id}/quote/versions`, { data: quoteData, paymentSchedule: schedule, approvalRequired: false })).data;
    expect(v1.approvalRequired).toBe(true); expect(v1.versionNo).toBe(1); expect(v1.total).toBeGreaterThan(0);
    expect((await eng.get(`/leads/${lead.id}`)).data.engineerStatus.key).toBe('quote_waiting_approval');
    expect((await eng.post(`/quote-versions/${v1.id}/send`)).error.code).toBe('APPROVAL_REQUIRED');
    const bad = await eng.post(`/leads/${lead.id}/quote/versions`, { data: quoteData, paymentSchedule: [{ name: 'A', pct: 50 }] });
    expect(bad.status).toBe(400);
    await approveAll('quote_version');
    expect((await eng.post(`/quote-versions/${v1.id}/send`)).status).toBe(200);
    expect((await eng.get(`/leads/${lead.id}`)).data.engineerStatus.key).toBe('quote_sent');
    const v2 = (await eng.post(`/leads/${lead.id}/quote/versions`, { data: { ...quoteData, discountValue: 5000 }, paymentSchedule: schedule, approvalRequired: false })).data;
    expect(v2.approvalRequired).toBe(false); expect(v2.diffFromPrevious.discountValue).toBeTruthy();
    expect((await eng.post(`/quote-versions/${v2.id}/send`)).status).toBe(200);
    expect((await eng.get(`/leads/${lead.id}`)).data.engineerStatus.key).toBe('multiple_quotes_sent');
    const pdf = await eng.get(`/quote-versions/${v2.id}/pdf`);
    expect(pdf.status).toBe(200);
    const pdf1 = (await eng.get(`/quote-versions/${v1.id}/pdf`)).raw.body;
    expect(pdf1).not.toContain('DRAFT – NOT APPROVED');
    // finance: totals only
    await acceptedFinalQuote(lead.id); await eng.post(`/leads/${lead.id}/push-to-finance`);
    const fq = (await fin.get(`/leads/${lead.id}/quote`)).data;
    expect(fq.versions[0].data).toBeUndefined(); expect(fq.versions[0].total).toBeGreaterThan(0);
  });
  it('watermark appears while unapproved', async () => {
    const lead = await transferred();
    const v1 = (await eng.post(`/leads/${lead.id}/quote/versions`, { data: quoteData, paymentSchedule: schedule })).data;
    expect((await eng.get(`/quote-versions/${v1.id}/pdf`)).raw.body).toContain('DRAFT – NOT APPROVED');
  });
});

describe('9.8 push to finance', () => {
  it('needs final + approved + accepted + billing; creates pipeline + milestones', async () => {
    const lead = await transferred();
    expect((await eng.post(`/leads/${lead.id}/push-to-finance`)).error.code).toBe('NO_FINAL_QUOTE');
    const v = (await eng.post(`/leads/${lead.id}/quote/versions`, { data: quoteData, paymentSchedule: schedule, isFinal: true })).data;
    expect((await eng.post(`/leads/${lead.id}/push-to-finance`)).error.code).toBe('FINAL_NOT_APPROVED');
    await approveAll('quote_version');
    expect((await eng.post(`/leads/${lead.id}/push-to-finance`)).error.code).toBe('NOT_ACCEPTED');
    await eng.post(`/quote-versions/${v.id}/send`);
    await eng.post(`/quote-versions/${v.id}/mark-accepted`);
    expect((await eng.get(`/leads/${lead.id}`)).data.engineerStatus.key).toBe('quote_approved_payment');
    expect((await eng.post(`/leads/${lead.id}/push-to-finance`)).error.code).toBe('BILLING_INCOMPLETE');
    await eng.put(`/leads/${lead.id}/billing`, { legalName: 'T', billingAddress: 'A', state: 'Karnataka', siteAddress: 'S', contactName: 'C', contactPhone: '+919700000002', contactEmail: 'c@example.org' });
    const r = await eng.post(`/leads/${lead.id}/push-to-finance`);
    expect(r.status).toBe(200); expect(r.data.pipeline.milestones).toHaveLength(3); expect(r.data.stage).toBe('pushed_to_finance');
    expect(Math.round(r.data.pipeline.milestones.reduce((a: number, m: any) => a + m.amount, 0))).toBe(Math.round(v.total));
  });
});

describe('9.9 / 9.10 finance', () => {
  it('finance cannot read meetings/notes/quote versions; pct change via approval; invoice numbering, GST split, payment → receipt + advance_paid', async () => {
    const lead = await transferred();
    await acceptedFinalQuote(lead.id);
    await eng.post(`/leads/${lead.id}/push-to-finance`);
    expect((await fin.get(`/leads/${lead.id}/notes`)).status).toBe(403);
    expect((await fin.get(`/meetings?leadId=${lead.id}`)).status).toBe(403);
    const fl = (await fin.get(`/leads/${lead.id}`)).data; expect(fl.meetings).toBeUndefined(); expect(fl.aiProfile).toBeUndefined();
    const p = (await fin.get(`/leads/${lead.id}/pipeline`)).data;
    expect((await fin.patch(`/milestones/${p.milestones[0].id}`, { amount: 1 })).error.code).toBe('PCT_CHANGE_REQUIRES_APPROVAL');
    expect((await fin.post(`/milestones/${p.milestones[0].id}/request-pct-change`, { newPct: 50, reason: 'client asked' })).status).toBe(200);
    await approveAll('milestone_pct_change');
    const p2 = (await fin.get(`/leads/${lead.id}/pipeline`)).data;
    expect(p2.milestones[0].pct).toBe(50); expect(p2.milestones.reduce((a: number, m: any) => a + m.pct, 0)).toBe(100);
    const inv = (await fin.post(`/milestones/${p2.milestones[0].id}/invoice`)).data;
    expect(inv.status).toBe('draft'); expect(inv.fullNumber).toBeNull();
    expect(inv.cgst).toBeGreaterThan(0); expect(inv.igst).toBe(0); // Maharashtra == Maharashtra
    const sent = (await fin.post(`/invoices/${inv.id}/send`)).data;
    expect(sent.fullNumber).toMatch(/^INV\/\d{4}-\d{2}\/\d{4}$/); expect(sent.status).toBe('sent');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe('invoice_sent');
    expect(await prisma.message.count({ where: { leadId: lead.id, templateKey: { in: ['invoice_link', 'invoice_pdf'] } } })).toBe(3);
    const part = await fin.post(`/invoices/${inv.id}/payments`, { amount: 1000, mode: 'upi', paidOn: new Date().toISOString() });
    expect(part.status).toBe(201); expect(part.data.receipt.fullNumber).toMatch(/^RCP\//);
    expect((await fin.get(`/invoices/${inv.id}`)).data.status).toBe('partially_paid');
    const rest = await fin.post(`/invoices/${inv.id}/payments`, { amount: sent.total - 1000, mode: 'neft', paidOn: new Date().toISOString() });
    expect(rest.status).toBe(201);
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { engineerStatus: true } });
    expect(after.stage).toBe('advance_paid'); expect(after.engineerStatus?.key).toBe('advance_paid');
    expect(await prisma.message.count({ where: { leadId: lead.id, templateKey: 'receipt_thankyou' } })).toBeGreaterThanOrEqual(6);
    expect((await fin.post(`/invoices/${inv.id}/payments`, { amount: 5, mode: 'cash', paidOn: new Date().toISOString() })).status).toBe(400);
    // credit note needs approval
    await fin.post(`/invoices/${inv.id}/credit-note`, { amount: 500, reason: 'goodwill' });
    expect(await prisma.creditNote.count({ where: { invoiceId: inv.id } })).toBe(0);
    await approveAll('credit_note');
    expect(await prisma.creditNote.count({ where: { invoiceId: inv.id } })).toBe(1);
    // sequential numbering
    const inv2 = (await fin.post(`/milestones/${p2.milestones[1].id}/invoice`)).data;
    const sent2 = (await fin.post(`/invoices/${inv2.id}/send`)).data;
    expect(Number(sent2.fullNumber.split('/')[2])).toBe(Number(sent.fullNumber.split('/')[2]) + 1);
  });
  it('IGST when billing state differs; push-back blocked after invoicing', async () => {
    const lead = await transferred();
    await acceptedFinalQuote(lead.id);
    await eng.put(`/leads/${lead.id}/billing`, { legalName: 'T', billingAddress: 'A', state: 'Karnataka', siteAddress: 'S', contactName: 'C', contactPhone: '+919700000003', contactEmail: 'c@example.org' });
    await eng.post(`/leads/${lead.id}/push-to-finance`);
    const p = (await fin.get(`/leads/${lead.id}/pipeline`)).data;
    expect((await fin.post(`/leads/${lead.id}/push-back-to-engineer`, { reason: 'fix schedule' })).status).toBe(200);
    expect((await eng.get(`/leads/${lead.id}`)).data.engineerStatus.key).toBe('asked_quote');
    const inv = (await fin.post(`/milestones/${p.milestones[0].id}/invoice`)).data;
    expect(inv.igst).toBeGreaterThan(0); expect(inv.cgst).toBe(0);
    expect((await fin.post(`/leads/${lead.id}/push-back-to-engineer`, { reason: 'x' })).error.code).toBe('INVOICED');
  });
});

describe('9.12 / 9.13 / 9.14 / 9.22 handover', () => {
  it('push-to-design only after advance paid; triple acceptance; engineer header-only; junior redaction; calendar visibility', async () => {
    const lead = await transferred();
    const headId = await userId('design_head'), jrId = await userId('junior_designer');
    expect((await eng.post(`/leads/${lead.id}/push-to-design`, { designHeadUserId: headId })).error.code).toBe('ADVANCE_NOT_PAID');
    expect((await eng.get(`/calendar/user/${headId}?from=${iso(0)}&to=${iso(1440)}`)).status).toBe(403);
    await advancePaid(lead.id);
    expect((await eng.post(`/leads/${lead.id}/push-to-design`, { designHeadUserId: headId })).status).toBe(200);
    expect((await eng.get(`/calendar/user/${headId}?from=${iso(0)}&to=${iso(1440)}`)).status).toBe(200);
    expect((await head.get('/design/leads')).data.some((l: any) => l.id === lead.id)).toBe(true);
    expect((await jr.get('/design/leads')).data.some((l: any) => l.id === lead.id)).toBe(false);
    expect((await head.post(`/handovers/${lead.id}/assign-junior`, { juniorUserId: jrId })).status).toBe(200);
    const jl = (await jr.get(`/leads/${lead.id}`)).data;
    expect(jl.client.phone).toBeUndefined(); expect(jl.client.email).toBeUndefined(); expect(jl.billing.contactPhone).toBeUndefined();
    // internal meeting: no client messages, attendees auto-added
    const before = await prisma.message.count({ where: { leadId: lead.id } });
    const im = (await eng.post('/meetings', { leadId: lead.id, kind: 'internal', type: 'meet', startAt: iso(5), endAt: iso(35), adminInvited: false })).data;
    expect(im.inviteAcceptedAt).toBeTruthy(); expect(im.attendeeUserIds).toContain(headId);
    expect(await prisma.message.count({ where: { leadId: lead.id } })).toBe(before);
    await eng.post(`/handovers/${lead.id}/accept`); await head.post(`/handovers/${lead.id}/accept`);
    expect((await prisma.handover.findUniqueOrThrow({ where: { leadId: lead.id } })).completedAt).toBeNull();
    const done = await jr.post(`/handovers/${lead.id}/accept`);
    expect(done.data.completedAt).toBeTruthy();
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { engineerStatus: true } });
    expect(l.stage).toBe('handover_accepted'); expect(l.engineerStatus?.key).toBe('handover_complete');
    const hdr = (await eng.get(`/leads/${lead.id}`)).data;
    expect(hdr.headerOnly).toBe(true); expect(hdr.client).toBeUndefined();
    expect((await eng.get(`/calendar/user/${headId}?from=${iso(0)}&to=${iso(1440)}`)).status).toBe(403);
  });
});

describe('9.15 / 9.18 / 9.20 admin', () => {
  it('lost at engineer stage → lost leads; audit written for writes; close-project deletes recordings but keeps text', async () => {
    const lead = await transferred();
    const m = await completedMeeting(lead.id);
    await eng.post(`/leads/${lead.id}/status`, { statusId: await statusId('engineer', 'lost'), reason: 'budget' });
    expect((await adm.get('/admin/lost-leads')).data.some((l: any) => l.id === lead.id)).toBe(true);
    expect((await adm.post(`/leads/${lead.id}/reassign`, { role: 'engineer', userId: await userId('engineer') })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityType: 'Lead', entityId: lead.id } })).toBeGreaterThan(0);
    await adm.post(`/leads/${lead.id}/close-project`, { keepRecordings: false });
    const rec = await prisma.recording.findFirst({ where: { meetingId: m.id } });
    expect(rec?.deletedAt).toBeTruthy();
    expect(await prisma.transcript.count({ where: { meetingId: m.id } })).toBe(1);
    const c = await prisma.client.findUniqueOrThrow({ where: { id: lead.clientId } });
    await adm.post(`/leads/${lead.id}/delete`);
    expect(await prisma.client.count({ where: { id: c.id } })).toBe(1);
    expect((await adm.del(`/clients/${c.id}`, { confirmation: 'wrong' })).status).toBe(400);
    expect((await adm.del(`/clients/${c.id}`, { confirmation: c.phone })).status).toBe(200);
  });
  it('view-as is logged; delays evaluate; reports csv; AI chat cites', async () => {
    const r = await adm.get(`/admin/view-as/${await userId('sales')}/leads`);
    expect(r.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'view_as' } })).toBeGreaterThan(0);
    await prisma.lead.updateMany({ data: { leadDate: new Date(Date.now() - 48 * 3600000) } });
    await adm.post('/admin/delays/evaluate');
    expect((await adm.get('/delays')).data.length).toBeGreaterThan(0);
    const csv = await adm.get('/reports/leads_by_source.csv');
    expect(csv.status).toBe(200); expect(String(csv.raw.body)).toContain('key');
    const app = await getApp();
    const { login } = await import('./helpers.js');
    const chat = await app.inject({ method: 'POST', url: '/api/v1/admin/ai/chat', payload: { sessionId: 's1', message: 'What budget did the client mention?' }, cookies: { sid: await login('admin') } });
    expect(chat.statusCode).toBe(200); expect(chat.body).toContain('citations');
  });
  it('login allow-list: unknown email rejected', async () => {
    const app = await getApp();
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/dev-login', payload: { email: 'nobody@example.com' } });
    expect(r.statusCode).toBe(403); expect(r.json().error.code).toBe('NOT_AUTHORISED');
  });
});
