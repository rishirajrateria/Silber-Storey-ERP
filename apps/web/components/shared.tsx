'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, startOfDay, endOfDay, startOfWeek, format, isSameDay } from 'date-fns';
import { MapPin, Download } from 'lucide-react';
import { get, post, patch, fileUrl } from '@/lib/api';
import { useDirectory, useMe, userName } from '@/lib/hooks';
import { dt, ago, inr, title, dayLabel } from '@/lib/format';
import { toast, errToast } from '@/lib/store';
import { leadHref } from './leads';
import { Button, Chip, Dialog, Empty, Glass, PageHeader, Spinner, Stat, Table, Textarea, cn } from './ui';

/* ---------- ApprovalsList ---------- */
export function ApprovalsList({ admin, dashboard }: { admin?: boolean; dashboard?: string }) {
  const me = useMe()!; const dir = useDirectory();
  const [tab, setTab] = useState<'pending' | 'decided'>('pending'); const [decide, setDecide] = useState<any>(null); const [remark, setRemark] = useState(''); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['approvals', admin, dashboard, tab], queryFn: () => get(`/approvals?${admin ? '' : 'mine=1&'}${dashboard ? `dashboard=${dashboard}&` : ''}${tab === 'pending' ? 'status=pending' : ''}`).then((r) => (r.data as any[]).filter((a) => tab === 'pending' || a.status !== 'pending')) });
  const canApprove = me.user.role === 'admin' && me.user.permissions.some((p) => p.canApprove);
  const act = async (approve: boolean) => { setBusy(true); try { await post(`/approvals/${decide.id}/decide`, { approve, remark: remark || undefined }); toast(approve ? 'Approved' : 'Rejected'); setDecide(null); setRemark(''); q.refetch(); } catch (e) { errToast(e); } finally { setBusy(false); } };
  const summary = (a: any) => { const p = a.payload ?? {}; switch (a.type) { case 'quote_version': return `v${p.versionNo} · ${inr(p.total)}${p.isFinal ? ' · final' : ''}`; case 'duplicate_override': return `${p.phone} ${p.name ?? ''}`; case 'milestone_pct_change': return `${p.oldPct}% → ${p.newPct}% · ${p.reason}`; case 'credit_note': return `${inr(p.amount)} · ${p.reason}`; case 'new_user': return `${p.name} <${p.email}> as ${p.role}`; case 'meeting_invite': return `${p.clientName ?? ''} · ${dt(p.startAt)} (${p.type})`; default: return ''; } };
  return <div>
    <PageHeader title="Approvals" actions={<div className="glass-soft flex gap-1 p-1">{(['pending', 'decided'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn('rounded-lg px-3 py-1 text-[13px]', tab === t ? 'bg-accent/[.12] text-accent' : 'text-mute')}>{title(t)}</button>)}</div>} />
    {q.isLoading ? <Spinner /> : <Table head={['Type', 'Details', 'Lead', 'Requested by', 'When', 'Status', '']} rows={(q.data ?? []).map((a) => [
      <Chip key="t" color="accent">{title(a.type)}</Chip>, <span key="s" className="text-[13px]">{summary(a)}</span>, a.lead ? <Link key="l" className="text-accent hover:underline" href={leadHref(me.user.role, a.leadId)}>{a.lead.client?.name ?? a.lead.client?.phone}</Link> : '—', userName(dir.data, a.requestedByUserId), ago(a.createdAt),
      <Chip key="st" color={a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}>{a.status}</Chip>,
      a.status === 'pending' && canApprove ? <Button key="d" variant="ghost" className="h-8" onClick={() => setDecide(a)}>Decide</Button> : a.remark ? <span key="r" className="text-[12px] text-mute">{a.remark}</span> : '',
    ])} empty={tab === 'pending' ? 'No pending approvals' : 'No decided approvals'} />}
    <Dialog open={!!decide} onClose={() => setDecide(null)} title={decide ? title(decide.type) : ''}>{decide && <div className="space-y-3"><div className="glass-soft p-3 text-[13.5px]">{summary(decide)}</div>{decide.type === 'quote_version' && <a className="btn-ghost h-8" href={fileUrl(`/quote-versions/${decide.entityId}/pdf`)} target="_blank" rel="noreferrer">Open quote PDF</a>}<Textarea label="Remark (required to reject)" value={remark} onChange={(e) => setRemark(e.target.value)} /><div className="flex justify-end gap-2"><Button variant="danger" loading={busy} disabled={!remark.trim()} onClick={() => act(false)}>Reject</Button><Button loading={busy} onClick={() => act(true)}>Approve</Button></div></div>}</Dialog>
  </div>;
}

/* ---------- DelaysList ---------- */
export function DelaysList({ admin, dashboard }: { admin?: boolean; dashboard?: string }) {
  const me = useMe()!; const dir = useDirectory();
  const q = useQuery({ queryKey: ['delays', admin, dashboard], queryFn: () => get(`/delays?${admin ? '' : 'mine=1&'}${dashboard ? `dashboard=${dashboard}` : ''}`).then((r) => r.data as any[]) });
  return <div><PageHeader title="Delays" sub="SLA breaches, evaluated every 15 minutes; resolved automatically when the condition clears" actions={admin && <Button variant="ghost" onClick={() => post('/admin/delays/evaluate').then(() => q.refetch())}>Evaluate now</Button>} />
    {q.isLoading ? <Spinner /> : <Table head={['Rule', 'Lead', 'Dashboard', 'Owner', 'Threshold', 'Breached']} rows={(q.data ?? []).map((d) => [<Chip key="r" color="red">{title(d.ruleKey)}</Chip>, <Link key="l" className="text-accent hover:underline" href={leadHref(me.user.role, d.leadId)}>{d.lead?.client?.name ?? d.lead?.client?.phone}</Link>, d.dashboard, userName(dir.data, d.userId), `${d.thresholdHours} h`, ago(d.breachedAt)])} empty="No open delays" />}</div>;
}

/* ---------- StatsCards ---------- */
export function StatsCards({ dashboard }: { dashboard: string }) {
  const q = useQuery({ queryKey: ['stats', dashboard], queryFn: () => get(`/stats?dashboard=${dashboard}`).then((r) => r.data) });
  if (q.isLoading) return <Spinner />;
  const s = q.data ?? {};
  const keys = ['leads_by_source', 'leads_by_status', 'contact_rate', 'qualification_rate', 'meetings_summary', 'meeting_to_quote', 'quote_to_acceptance', 'approval_turnaround', 'invoice_to_payment', 'outstanding_ageing', 'sla_breaches', 'user_performance', 'collections_by_month'];
  return <div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{dashboard !== 'finance' && <><Stat label="Leads" value={s.total} /><Stat label="Open" value={s.open} /><Stat label="Transferred" value={s.transferred} /><Stat label="Meetings done" value={s.meetings} /><Stat label="Quotes sent" value={s.quotes} /></>}<Stat label="Invoiced" value={inr(s.invoiced)} /><Stat label="Collected" value={inr(s.collected)} /><Stat label="Open delays" value={s.delays} /><Stat label="Pending approvals" value={s.pendingApprovals} />
      {s.leadsToday != null && <><Stat label="Leads today" value={s.leadsToday} hint={`${s.leadsWeek} this week · ${s.leadsMonth} this month`} /><Stat label="Follow-ups due" value={s.followUpsDue} hint="next 24 h" /></>}
      {s.noShows != null && <><Stat label="No-shows" value={s.noShows} /><Stat label="Revisions / quote" value={s.revisionsPerQuote} /><Stat label="Avg ageing" value={`${s.avgAgeingDays} d`} hint={`${s.ageingOver7} leads > 7 d`} /></>}
      {s.outstanding != null && <><Stat label="Outstanding" value={inr(s.outstanding)} /><Stat label="Overdue invoices" value={s.overdueInvoices} hint="> 7 days" /></>}
      {s.handoversReceived != null && <><Stat label="Handovers" value={s.handoversReceived} hint={`${s.handoversPending} pending acceptance`} /><Stat label="Design meetings" value={s.designMeetings} /></>}
    </div>
    {s.lostReasons?.length > 0 && <Glass className="mt-4"><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Lost reasons</div>{s.lostReasons.map((r: any) => <div key={r.reason} className="flex justify-between py-1 text-[13px]"><span>{r.reason}</span><span className="font-mono">{r.count}</span></div>)}</Glass>}
    <Glass className="mt-4"><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Reports (CSV)</div><div className="flex flex-wrap gap-2">{keys.map((k) => <a key={k} className="btn-ghost h-8" href={fileUrl(`/reports/${k}.csv?dashboard=${dashboard}`)}><Download className="h-3.5 w-3.5" />{title(k)}</a>)}</div></Glass>
  </div>;
}

/* ---------- MyDay (map + list) ---------- */
export function MyDay() {
  const me = useMe()!; const role = me.user.role;
  const from = startOfDay(new Date()).toISOString(), to = endOfDay(addDays(new Date(), 1)).toISOString();
  const cal = useQuery({ queryKey: ['calendar', 'me', from], queryFn: () => get(`/calendar/me?from=${from}&to=${to}`).then((r) => r.data) });
  const overdue = useQuery({ queryKey: ['followups', 'overdue'], queryFn: () => get(`/followups?me=1&to=${new Date().toISOString()}`).then((r) => r.data as any[]) });
  const approvals = useQuery({ queryKey: ['approvals', 'mine', 'pending'], queryFn: () => get('/approvals?mine=1&status=pending').then((r) => r.data as any[]) });
  const finLeads = useQuery({ queryKey: ['finance', 'leads'], enabled: role === 'finance', queryFn: () => get('/finance/leads').then((r) => r.data as any[]) });
  const done = async (id: string) => { try { await patch(`/followups/${id}`, { done: true }); cal.refetch(); overdue.refetch(); } catch (e) { errToast(e); } };
  const consent = async () => { await post('/me/location-consent'); toast('Location sharing on'); location.reload(); };
  if (cal.isLoading) return <Spinner />;
  const meetings: any[] = cal.data?.meetings ?? []; const fus: any[] = cal.data?.followUps ?? [];
  const office = me.settings;
  const pins = meetings.filter((m) => m.type === 'site' && m.lead?.client?.addressLat).map((m) => `${m.lead.client.addressLat},${m.lead.client.addressLng}`);
  return <div>
    <PageHeader title="My Day" sub={format(new Date(), 'EEEE, d MMMM')} actions={!me.locationConsentAt && role !== 'admin' && <Button variant="ghost" onClick={consent}><MapPin className="h-4 w-4" />Share location</Button>} />
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {role === 'finance' ? <Glass><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Collections to action</div>{!finLeads.data?.length ? <Empty text="Nothing pending" /> : finLeads.data.map((l) => { const ms = l.pipeline?.milestones ?? []; const next = ms.find((m: any) => m.status !== 'paid'); return <Link key={l.id} href={`/finance/leads/${l.id}`} className="flex items-center justify-between py-2 text-[13.5px] hover:underline"><span>{l.client?.name ?? l.client?.phone}</span><span className="text-mute">{next ? `${next.name} · ${inr(next.amount)} · ${next.status}` : 'all paid'}</span></Link>; })}</Glass>
        : <Glass><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Today & tomorrow</div>
          {!meetings.length && !fus.length ? <Empty text="Nothing scheduled" /> : <div className="divide-y divide-white/10">
            {meetings.map((m) => <div key={m.id} className="flex items-center justify-between py-2.5 text-[13.5px]"><div><div className="font-medium">{m.lead?.client?.name ?? 'Meeting'} · {m.type}</div><div className="text-[12px] text-mute">{dayLabel(m.startAt)} {format(new Date(m.startAt), 'HH:mm')} · {m.status}{m.travelMin ? ` · ~${m.travelMin} min drive (${m.distanceKm} km)` : ''}</div></div>{m.type === 'site' && m.lead?.client?.addressLat && <a className="btn-ghost h-8" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${m.lead.client.addressLat},${m.lead.client.addressLng}`}>Navigate</a>}{role === 'engineer' ? <Link className="btn-ghost h-8" href={`/engineer/meetings/${m.id}`}>Room</Link> : <Link className="btn-ghost h-8" href={leadHref(role, m.leadId)}>Lead</Link>}</div>)}
            {fus.map((f) => <div key={f.id} className="flex items-center justify-between py-2.5 text-[13.5px]"><div><div className="font-medium">Follow-up · {f.lead?.client?.name ?? f.lead?.client?.phone}</div><div className="text-[12px] text-mute">{dayLabel(f.dueAt)} {format(new Date(f.dueAt), 'HH:mm')} · <Chip color={f.priority === 'high' ? 'red' : f.priority === 'med' ? 'amber' : 'gray'}>{f.priority}</Chip></div></div><div className="flex gap-1"><Link className="btn-ghost h-8" href={leadHref(role, f.leadId)}>Open</Link><Button variant="ghost" className="h-8" onClick={() => done(f.id)}>Done</Button></div></div>)}
          </div>}</Glass>}
        {(overdue.data?.length ?? 0) > 0 && <Glass className="border-red-300/40"><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-red-300">Overdue follow-ups</div>{overdue.data!.map((f) => <div key={f.id} className="flex items-center justify-between py-1.5 text-[13.5px]"><Link href={leadHref(role, f.leadId)} className="hover:underline">{f.lead?.client?.name ?? f.lead?.client?.phone} · {ago(f.dueAt)}</Link><Button variant="ghost" className="h-8" onClick={() => done(f.id)}>Done</Button></div>)}</Glass>}
      </div>
      <div className="space-y-4">
        <Glass className="overflow-hidden p-0"><iframe title="map" className="h-56 w-full" src={`https://www.google.com/maps?q=${pins[0] ?? `${office?.officeLat},${office?.officeLng}`}&z=12&output=embed`} /><div className="p-3 text-[12.5px] text-mute">{pins.length ? `${pins.length} site visit(s) today` : 'Office'}</div></Glass>
        <Glass><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">My pending approvals</div>{!approvals.data?.length ? <div className="text-[13px] text-mute">None</div> : approvals.data.map((a) => <div key={a.id} className="py-1 text-[13px]"><Chip color="amber">{title(a.type)}</Chip> <span className="text-mute">{ago(a.createdAt)}</span></div>)}</Glass>
      </div>
    </div>
  </div>;
}

/* ---------- CalendarView (week) ---------- */
export function CalendarView() {
  const me = useMe()!; const role = me.user.role;
  const [start, setStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const from = start.toISOString(), to = addDays(start, 7).toISOString();
  const q = useQuery({ queryKey: ['calendar', from], queryFn: () => get(`/calendar/me?from=${from}&to=${to}`).then((r) => r.data) });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const items = [...(q.data?.meetings ?? []).map((m: any) => ({ at: m.startAt, label: `${format(new Date(m.startAt), 'HH:mm')} ${m.lead?.client?.name ?? 'Meeting'} (${m.type})`, href: role === 'engineer' ? `/engineer/meetings/${m.id}` : leadHref(role, m.leadId), kind: 'meeting' })), ...(q.data?.followUps ?? []).map((f: any) => ({ at: f.dueAt, label: `${format(new Date(f.dueAt), 'HH:mm')} Follow-up ${f.lead?.client?.name ?? ''}`, href: leadHref(role, f.leadId), kind: 'fu' })), ...(q.data?.busy ?? []).map((b: any) => ({ at: b.start, label: `${format(new Date(b.start), 'HH:mm')}–${format(new Date(b.end), 'HH:mm')} busy (Google)`, href: '#', kind: 'busy' }))];
  return <div><PageHeader title="Calendar" sub="App meetings, follow-ups and Google free/busy" actions={<div className="flex gap-2"><Button variant="ghost" onClick={() => setStart(addDays(start, -7))}>‹</Button><Button variant="ghost" onClick={() => setStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>This week</Button><Button variant="ghost" onClick={() => setStart(addDays(start, 7))}>›</Button></div>} />
    {q.isLoading ? <Spinner /> : <div className="grid gap-2 md:grid-cols-7">{days.map((d) => <Glass key={d.toISOString()} className={cn('min-h-[120px] p-3', isSameDay(d, new Date()) && 'border-accent/50')}><div className="mb-2 text-[12px] font-medium text-mute">{format(d, 'EEE d')}</div><div className="space-y-1">{items.filter((i) => isSameDay(new Date(i.at), d)).sort((a, b) => a.at.localeCompare(b.at)).map((i, k) => <Link key={k} href={i.href} className={cn('block truncate rounded-lg px-2 py-1 text-[12px]', i.kind === 'meeting' ? 'bg-accent/[.12] text-accent' : i.kind === 'fu' ? 'bg-amber-400/10 text-amber-300' : 'bg-white/5 text-mute')}>{i.label}</Link>)}</div></Glass>)}</div>}</div>;
}

/* ---------- Dashboard overview ---------- */
export function Overview({ dashboard }: { dashboard: string }) {
  const me = useMe()!;
  return <div><PageHeader title={`Hello, ${me.user.name.split(' ')[0]}`} sub={`${title(dashboard)} dashboard`} /><StatsCards dashboard={dashboard} /></div>;
}
