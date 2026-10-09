'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Send, Trash2, Plus } from 'lucide-react';
import { STAGES, NOTIFICATION_EVENTS, REPORT_KEYS, TEMPLATE_VARIABLES, ROLES } from '@app/shared';
import { get, post, put, patch, del, fileUrl } from '@/lib/api';
import { useDirectory, useMe, userName } from '@/lib/hooks';
import { dt, ago, inr, title, dd } from '@/lib/format';
import { toast, errToast } from '@/lib/store';
import { Button, Chip, Dialog, Empty, Glass, Input, KV, PageHeader, Pager, Select, Spinner, Stat, StageBadge, StatusChip, Table, Textarea, Toggle, useConfirm, cn } from './ui';

export function AdminOverview() {
  const s = useQuery({ queryKey: ['stats', 'global'], queryFn: () => get('/stats?dashboard=global').then((r) => r.data) });
  const loc = useQuery({ queryKey: ['locations'], queryFn: () => get('/admin/users-locations').then((r) => r.data as any[]), refetchInterval: 60000 });
  return <div><PageHeader title="Admin overview" />
    {s.isLoading ? <Spinner /> : <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Leads" value={s.data.total} /><Stat label="Open" value={s.data.open} /><Stat label="Invoiced" value={inr(s.data.invoiced)} /><Stat label="Collected" value={inr(s.data.collected)} /><Link href="/admin/approvals"><Stat label="Pending approvals" value={s.data.pendingApprovals} /></Link><Link href="/admin/delays"><Stat label="Open delays" value={s.data.delays} /></Link><Stat label="Meetings done" value={s.data.meetings} /><Stat label="Quotes sent" value={s.data.quotes} /></div>}
    <Glass className="mt-4"><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Team · last seen & location</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(loc.data ?? []).map((u) => <div key={u.id} className="glass-soft flex items-center justify-between p-3 text-[13px]"><div><div className="font-medium">{u.name}</div><div className="text-mute">{title(u.role)} · seen {ago(u.lastSeenAt)}</div></div>{u.lastLat ? <a className="text-accent hover:underline" target="_blank" href={`https://www.google.com/maps?q=${u.lastLat},${u.lastLng}`} rel="noreferrer">map · {ago(u.lastLocAt)}</a> : <span className="text-mute">no location</span>}</div>)}</div></Glass>
  </div>;
}

/* ---------- /admin/d/[dashboard] tabs ---------- */
export function DashboardAdmin({ dashboard }: { dashboard: string }) {
  const [tab, setTab] = useState('analytics');
  const tabs = ['analytics', 'users', 'statuses', 'notifications', 'templates', 'settings'];
  const dashes = ['sales', 'engineer', 'finance', 'design_head', 'junior_designer'];
  return <div>
    <PageHeader title={`${title(dashboard)} dashboard`} actions={<div className="glass-soft flex gap-1 p-1">{dashes.map((d) => <Link key={d} href={`/admin/d/${d}`} className={cn('rounded-lg px-3 py-1 text-[13px]', d === dashboard ? 'bg-white text-accent shadow-soft' : 'text-ink/70')}>{title(d)}</Link>)}</div>} />
    <div className="glass-soft mb-4 flex gap-1 overflow-x-auto p-1">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium', tab === t ? 'bg-white text-accent shadow-soft' : 'text-ink/70')}>{t === 'users' ? 'Users & Permissions' : t === 'notifications' ? 'Notification rules' : title(t)}</button>)}</div>
    {tab === 'analytics' && <Analytics dashboard={dashboard} />}{tab === 'users' && <UsersAdmin role={dashboard} />}{tab === 'statuses' && <StatusesAdmin dashboard={dashboard === 'sales' ? 'sales' : 'engineer'} />}{tab === 'notifications' && <NotificationRules dashboard={dashboard} />}{tab === 'templates' && <TemplatesAdmin />}{tab === 'settings' && <SettingsForm />}
  </div>;
}
function Analytics({ dashboard }: { dashboard: string }) {
  const q = useQuery({ queryKey: ['analytics', dashboard], queryFn: () => get(`/admin/analytics/${dashboard}`).then((r) => r.data) });
  if (q.isLoading) return <Spinner />;
  const { stats, ...reports } = q.data ?? {};
  return <div><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Leads" value={stats?.total} /><Stat label="Open" value={stats?.open} /><Stat label="Delays" value={stats?.delays} /><Stat label="Collected" value={inr(stats?.collected)} /></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">{Object.entries(reports).map(([k, rows]: any) => <Glass key={k}><div className="mb-2 flex items-center justify-between"><div className="text-[12px] font-medium uppercase tracking-wide text-mute">{title(k)}</div><a className="text-[12px] text-accent" href={fileUrl(`/reports/${k}.csv?dashboard=${dashboard}`)}><Download className="inline h-3.5 w-3.5" /> CSV</a></div>{!rows?.length ? <div className="text-[13px] text-mute">No data</div> : <table className="w-full text-[12.5px]"><thead><tr>{Object.keys(rows[0]).map((c) => <th key={c} className="th">{title(c)}</th>)}</tr></thead><tbody>{rows.slice(0, 12).map((r: any, i: number) => <tr key={i} className="border-t border-white/60">{Object.values(r).map((v: any, j) => <td key={j} className="td">{typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? '—').slice(0, 40)}</td>)}</tr>)}</tbody></table>}</Glass>)}</div></div>;
}
export function UsersAdmin({ role }: { role?: string }) {
  const q = useQuery({ queryKey: ['users'], queryFn: () => get('/users').then((r) => r.data as any[]) });
  const [f, setF] = useState({ email: '', name: '', role: role && ROLES.includes(role as any) ? role : 'sales' }); const [busy, setBusy] = useState(false);
  const add = async () => { setBusy(true); try { await post('/users', f); toast('User added'); setF({ ...f, email: '', name: '' }); q.refetch(); } catch (e) { errToast(e); } finally { setBusy(false); } };
  const upd = async (id: string, data: any) => { try { await patch(`/users/${id}`, data); q.refetch(); } catch (e) { errToast(e); } };
  const users = (q.data ?? []).filter((u) => !role || u.role === role || role === 'global');
  return <div className="space-y-4">
    <Glass><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Add user (Google sign-in is allow-listed by email)</div><div className="grid gap-2 sm:grid-cols-4"><Input placeholder="email@company.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{title(r)}</option>)}</Select><Button loading={busy} disabled={!f.email || !f.name} onClick={add}>Add</Button></div></Glass>
    {q.isLoading ? <Spinner /> : <Table head={['Name', 'Email', 'Role', 'Active', 'Last seen', '']} rows={users.map((u) => [u.name, u.email, <select key="r" className="field h-8 w-40" value={u.role} onChange={(e) => upd(u.id, { role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{title(r)}</option>)}</select>, <Toggle key="a" checked={u.active} onChange={(v) => upd(u.id, { active: v })} />, ago(u.lastSeenAt), <Link key="v" className="text-[12.5px] text-accent hover:underline" href={`/admin/view-as/${u.id}`}>View as</Link>])} />}
  </div>;
}
function StatusesAdmin({ dashboard }: { dashboard: 'sales' | 'engineer' }) {
  const q = useQuery({ queryKey: ['admin-statuses', dashboard], queryFn: () => get(`/admin/statuses/${dashboard}`).then((r) => r.data as any[]) });
  const [f, setF] = useState({ key: '', label: '', requiresFollowUp: false, isFinal: false });
  const add = async () => { try { await post(`/admin/statuses/${dashboard}`, { ...f, order: (q.data?.length ?? 0) + 1 }); setF({ key: '', label: '', requiresFollowUp: false, isFinal: false }); q.refetch(); } catch (e) { errToast(e); } };
  const upd = async (id: string, data: any) => { try { await patch(`/admin/statuses/${dashboard}/${id}`, data); q.refetch(); } catch (e) { errToast(e); } };
  const rm = async (id: string) => { try { await del(`/admin/statuses/${dashboard}/${id}`); q.refetch(); } catch (e) { errToast(e); } };
  return <div className="space-y-4">
    <Glass><div className="grid gap-2 sm:grid-cols-5"><Input placeholder="key_snake_case" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /><Input placeholder="Label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /><div className="pt-2"><Toggle checked={f.requiresFollowUp} onChange={(v) => setF({ ...f, requiresFollowUp: v })} label="Follow-up" /></div><div className="pt-2"><Toggle checked={f.isFinal} onChange={(v) => setF({ ...f, isFinal: v })} label="Final" /></div><Button disabled={!f.key || !f.label} onClick={add}><Plus className="h-4 w-4" />Status</Button></div></Glass>
    {q.isLoading ? <Spinner /> : <Table head={['Order', 'Key', 'Label', 'Follow-up', 'Final', 'System', 'Active', '']} rows={(q.data ?? []).map((s) => [<input key="o" type="number" className="field h-8 w-16" defaultValue={s.order} onBlur={(e) => Number(e.target.value) !== s.order && upd(s.id, { order: Number(e.target.value) })} />, <code key="k" className="text-[12px]">{s.key}</code>, <input key="l" className="field h-8" defaultValue={s.label} onBlur={(e) => e.target.value !== s.label && upd(s.id, { label: e.target.value })} />, <Toggle key="f" checked={s.requiresFollowUp} onChange={(v) => upd(s.id, { requiresFollowUp: v })} />, <Toggle key="fi" checked={s.isFinal} onChange={(v) => upd(s.id, { isFinal: v })} />, s.isSystem ? <Chip key="s" color="violet">system</Chip> : '', <Toggle key="a" checked={s.active} onChange={(v) => upd(s.id, { active: v })} />, !s.isSystem ? <button key="d" onClick={() => rm(s.id)} className="text-mute hover:text-red-600"><Trash2 className="h-4 w-4" /></button> : ''])} />}
    <SourcesAdmin />
  </div>;
}
function SourcesAdmin() {
  const q = useQuery({ queryKey: ['admin-sources'], queryFn: () => get('/admin/lead-sources').then((r) => r.data as any[]) });
  const [label, setLabel] = useState('');
  return <Glass><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Lead sources</div><div className="mb-2 flex gap-2"><Input placeholder="New source" value={label} onChange={(e) => setLabel(e.target.value)} /><Button disabled={!label} onClick={async () => { await post('/admin/lead-sources', { label, order: (q.data?.length ?? 0) + 1 }); setLabel(''); q.refetch(); }}>Add</Button></div><div className="flex flex-wrap gap-2">{(q.data ?? []).map((s) => <span key={s.id} className={cn('chip', s.active ? 'border-ink/10 bg-white/60' : 'border-ink/10 bg-ink/5 text-mute line-through')}>{s.label}<button className="ml-1 text-mute" onClick={async () => { await patch(`/admin/lead-sources/${s.id}`, { active: !s.active }); q.refetch(); }}>{s.active ? '×' : '↺'}</button></span>)}</div></Glass>;
}
function NotificationRules({ dashboard }: { dashboard: string }) {
  const q = useQuery({ queryKey: ['nrules', dashboard], queryFn: () => get(`/admin/notification-rules/${dashboard}`).then((r) => r.data as any[]) });
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { if (q.data) setRows(NOTIFICATION_EVENTS.map((e) => q.data!.find((r) => r.eventKey === e) ?? { eventKey: e, inApp: true, email: false, whatsapp: false, sms: false, timingOffsetsMin: [] })); }, [q.data]);
  const set = (i: number, k: string, v: any) => setRows(rows!.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => { try { await put(`/admin/notification-rules/${dashboard}`, rows!.map((r) => ({ eventKey: r.eventKey, inApp: r.inApp, email: r.email, whatsapp: r.whatsapp, sms: r.sms, timingOffsetsMin: r.timingOffsetsMin ?? [] }))); toast('Saved'); } catch (e) { errToast(e); } };
  if (!rows) return <Spinner />;
  return <div><div className="mb-3 flex justify-end"><Button onClick={save}>Save rules</Button></div><Table head={['Event', 'In-app', 'Email', 'WhatsApp', 'SMS', 'Reminder offsets (min)']} rows={rows.map((r, i) => [title(r.eventKey), <Toggle key="a" checked={r.inApp} onChange={(v) => set(i, 'inApp', v)} />, <Toggle key="e" checked={r.email} onChange={(v) => set(i, 'email', v)} />, <Toggle key="w" checked={r.whatsapp} onChange={(v) => set(i, 'whatsapp', v)} />, <Toggle key="s" checked={r.sms} onChange={(v) => set(i, 'sms', v)} />, r.eventKey.includes('reminder') || r.eventKey.includes('due') ? <input key="t" className="field h-8 w-32" defaultValue={(r.timingOffsetsMin ?? []).join(',')} onBlur={(e) => set(i, 'timingOffsetsMin', e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => !isNaN(x) && x > 0))} /> : ''])} /></div>;
}

/* ---------- TemplateEditor ---------- */
export function TemplatesAdmin() {
  const q = useQuery({ queryKey: ['templates'], queryFn: () => get('/admin/templates').then((r) => r.data as any[]) });
  const [sel, setSel] = useState<any>(null); const [body, setBody] = useState(''); const [name, setName] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const open = (t: any) => { setSel(t); setBody(t.body); setName(t.name); };
  const insert = (v: string) => { const el = ref.current; const tag = `{{${v}}}`; if (!el) return setBody(body + tag); const s = el.selectionStart; setBody(body.slice(0, s) + tag + body.slice(el.selectionEnd)); };
  const save = async () => { try { await patch(`/admin/templates/${sel.id}`, { body, name }); toast('Saved'); q.refetch(); } catch (e) { errToast(e); } };
  const submit = async () => { try { const r = await post(`/admin/templates/${sel.id}/submit`); toast(`Submitted · ${r.data.providerStatus}`); q.refetch(); } catch (e) { errToast(e); } };
  const preview = body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => ({ client_name: 'Rahul', company: 'Silber Storey', meeting_datetime: '12 Oct, 11:00', meeting_type: 'site', amount: '1,20,000', invoice_number: 'INV/2026-27/0007', quote_total: '12,40,000' } as any)[k] ?? `[${k}]`);
  return <div className="grid gap-4 lg:grid-cols-3">
    <Glass className="p-2 lg:col-span-1">{q.isLoading ? <Spinner /> : (q.data ?? []).map((t) => <button key={t.id} onClick={() => open(t)} className={cn('flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] hover:bg-white/60', sel?.id === t.id && 'bg-white shadow-soft')}><span><Chip color={t.channel === 'whatsapp' ? 'green' : t.channel === 'sms' ? 'amber' : 'blue'}>{t.channel}</Chip> <span className="ml-1">{t.key}</span></span>{t.providerStatus && <span className="text-[11px] text-mute">{t.providerStatus}</span>}</button>)}</Glass>
    <Glass className="lg:col-span-2">{!sel ? <Empty text="Select a template" /> : <div className="space-y-3"><Input label="Name / subject" value={name} onChange={(e) => setName(e.target.value)} />
      <div><span className="label">Variables</span><div className="flex flex-wrap gap-1">{TEMPLATE_VARIABLES.map((v) => <button key={v} onClick={() => insert(v)} className="chip border-accent/20 bg-accent/5 text-accent hover:bg-accent/10">{`{{${v}}}`}</button>)}</div></div>
      <label className="block"><span className="label">Body</span><textarea ref={ref} className="field min-h-[160px] font-mono text-[12.5px]" value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <div><span className="label">Preview</span><div className="glass-soft whitespace-pre-wrap p-3 text-[13px]">{preview}</div></div>
      <div className="flex justify-end gap-2">{sel.channel === 'whatsapp' && <Button variant="ghost" onClick={submit}><Send className="h-4 w-4" />Submit to WhatsApp</Button>}<Button onClick={save}>Save</Button></div></div>}</Glass>
  </div>;
}

/* ---------- SettingsForm (incl. empty Cap section) ---------- */
export function SettingsForm() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get('/admin/settings').then((r) => r.data) });
  const [s, setS] = useState<any>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  if (!s) return <Spinner />;
  const b = s.branding ?? {}; const setB = (k: string, v: any) => setS({ ...s, branding: { ...b, [k]: v } });
  const save = async () => { setBusy(true); try { await put('/admin/settings', s); toast('Settings saved'); } catch (e) { errToast(e); } finally { setBusy(false); } };
  const rc = s.rateCard;
  return <div className="space-y-4">
    <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Branding</div><div className="grid gap-3 sm:grid-cols-3"><Input label="Company" value={b.companyName ?? ''} onChange={(e) => setB('companyName', e.target.value)} /><Input label="Primary colour" type="color" value={b.colors?.primary ?? '#1F3A5F'} onChange={(e) => setB('colors', { ...(b.colors ?? {}), primary: e.target.value })} /><Input label="State (GST)" value={b.state ?? ''} onChange={(e) => setB('state', e.target.value)} /><Input label="GSTIN" value={b.gstin ?? ''} onChange={(e) => setB('gstin', e.target.value)} /><Input label="Phone" value={b.phone ?? ''} onChange={(e) => setB('phone', e.target.value)} /><Input label="Email" value={b.email ?? ''} onChange={(e) => setB('email', e.target.value)} /><div className="sm:col-span-3"><Input label="Address" value={b.address ?? ''} onChange={(e) => setB('address', e.target.value)} /></div></div></Glass>
    <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Numbers & tax</div><div className="grid gap-3 sm:grid-cols-4"><Input label="GST %" type="number" value={s.gstPct} onChange={(e) => setS({ ...s, gstPct: Number(e.target.value) })} /><Input label="HSN/SAC" value={s.hsnSac} onChange={(e) => setS({ ...s, hsnSac: e.target.value })} /><Input label="Invoice series" value={s.invoiceSeries} onChange={(e) => setS({ ...s, invoiceSeries: e.target.value })} /><Input label="Receipt series" value={s.receiptSeries} onChange={(e) => setS({ ...s, receiptSeries: e.target.value })} /><Input label="Credit note series" value={s.creditNoteSeries} onChange={(e) => setS({ ...s, creditNoteSeries: e.target.value })} /><Input label="FY reset month" type="number" value={s.fyResetMonth} onChange={(e) => setS({ ...s, fyResetMonth: Number(e.target.value) })} /><Input label="Quote validity (days)" type="number" value={s.quoteValidityDays} onChange={(e) => setS({ ...s, quoteValidityDays: Number(e.target.value) })} /><Input label="Check-in radius (m)" type="number" value={s.checkinRadiusM} onChange={(e) => setS({ ...s, checkinRadiusM: Number(e.target.value) })} /></div></Glass>
    <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Office & quiet hours</div><div className="grid gap-3 sm:grid-cols-4"><div className="sm:col-span-2"><Input label="Office address" value={s.officeAddress ?? ''} onChange={(e) => setS({ ...s, officeAddress: e.target.value })} /></div><Input label="Lat" type="number" value={s.officeLat} onChange={(e) => setS({ ...s, officeLat: Number(e.target.value) })} /><Input label="Lng" type="number" value={s.officeLng} onChange={(e) => setS({ ...s, officeLng: Number(e.target.value) })} /><Input label="Quiet hours start" type="time" value={s.quietHours?.start ?? ''} onChange={(e) => setS({ ...s, quietHours: { ...(s.quietHours ?? {}), start: e.target.value } })} /><Input label="Quiet hours end" type="time" value={s.quietHours?.end ?? ''} onChange={(e) => setS({ ...s, quietHours: { ...(s.quietHours ?? {}), end: e.target.value } })} /></div></Glass>
    <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Rate card</div><div className="mb-3 grid gap-3 sm:grid-cols-3">{Object.entries(rc.packages).map(([k, v]: any) => <Input key={k} label={`${title(k)} ₹/sqft`} type="number" value={v} onChange={(e) => setS({ ...s, rateCard: { ...rc, packages: { ...rc.packages, [k]: Number(e.target.value) } } })} />)}</div>
      <table className="w-full text-[13px]"><thead><tr><th className="th">Item</th><th className="th">Unit</th><th className="th">Rate</th></tr></thead><tbody>{rc.items.map((it: any, i: number) => <tr key={it.key} className="border-t border-white/60"><td className="td">{it.label}</td><td className="td">{it.unit}</td><td className="td"><input type="number" className="field h-8 w-28" value={it.rate} onChange={(e) => setS({ ...s, rateCard: { ...rc, items: rc.items.map((x: any, j: number) => (j === i ? { ...x, rate: Number(e.target.value) } : x)) } })} /></td></tr>)}</tbody></table>
      <div className="mt-3 grid gap-2 sm:grid-cols-5">{rc.services.map((sv: any, i: number) => <Input key={sv.key} label={`${sv.label} (${sv.defaultMode})`} type="number" value={sv.defaultValue} onChange={(e) => setS({ ...s, rateCard: { ...rc, services: rc.services.map((x: any, j: number) => (j === i ? { ...x, defaultValue: Number(e.target.value) } : x)) } })} />)}</div></Glass>
    <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Quote texts</div><div className="grid gap-3 lg:grid-cols-3"><Textarea label="Inclusions" value={s.inclusionsText} onChange={(e) => setS({ ...s, inclusionsText: e.target.value })} /><Textarea label="Exclusions" value={s.exclusionsText} onChange={(e) => setS({ ...s, exclusionsText: e.target.value })} /><Textarea label="Terms" value={s.termsText} onChange={(e) => setS({ ...s, termsText: e.target.value })} /></div></Glass>
    <Glass><div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-mute">Cap</div><div className="text-[13px] text-mute">No caps or limits are configured in Phase 1. This section is reserved.</div></Glass>
    <div className="flex justify-end"><Button loading={busy} onClick={save}>Save settings</Button></div>
  </div>;
}

/* ---------- Projects roadmap ---------- */
export function ProjectsRoadmap() {
  const [fromStage, setFrom] = useState('');
  const q = useQuery({ queryKey: ['projects', fromStage], queryFn: () => get(`/admin/ongoing-projects?fromStage=${fromStage}`).then((r) => r.data as any[]) });
  return <div><PageHeader title="Ongoing projects" sub="Roadmap per lead with days per stage" actions={<Select value={fromStage} onChange={(e) => setFrom(e.target.value)}><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{title(s)} +</option>)}</Select>} />
    {q.isLoading ? <Spinner /> : !q.data?.length ? <Glass><Empty text="No projects" /></Glass> : <div className="space-y-3">{q.data.map((l) => <RoadmapStepper key={l.id} lead={l} />)}</div>}</div>;
}
function RoadmapStepper({ lead }: { lead: any }) {
  const hist: any[] = lead.statusHistory ?? []; const idx = STAGES.indexOf(lead.stage);
  return <Glass className="p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Link href={`/admin/leads/${lead.id}`} className="font-medium text-accent hover:underline">{lead.client?.name ?? lead.client?.phone}</Link><div className="flex gap-2"><StatusChip status={lead.engineerStatus ?? lead.salesStatus} />{lead.delays?.length > 0 && <Chip color="red">{lead.delays.length} delay(s)</Chip>}</div></div>
    <div className="flex gap-1 overflow-x-auto pb-1">{STAGES.map((s, i) => { const h = hist.find((x) => x.toStatusId === s); const next = hist.find((x) => STAGES.indexOf(x.toStatusId) > i); const days = h ? ((next ? new Date(next.at).getTime() : Date.now()) - new Date(h.at).getTime()) / 86400000 : null; return <div key={s} title={`${title(s)}${h ? ` · ${dd(h.at)} · ${days!.toFixed(1)} d` : ''}`} className={cn('h-7 min-w-[34px] flex-1 rounded-md text-center text-[10px] leading-7', i < idx ? 'bg-accent/70 text-white' : i === idx ? 'bg-accent text-white ring-2 ring-accent/30' : 'bg-ink/5 text-mute')}>{days != null ? `${days.toFixed(0)}d` : ''}</div>; })}</div>
    <div className="mt-1 text-[11.5px] text-mute">Current: {title(lead.stage)} · since {dd(hist.at(-1)?.at)}</div></Glass>;
}

/* ---------- Audit, messages, lost leads, clients, admins, reports, view-as ---------- */
export function AuditViewer() {
  const dir = useDirectory(); const [f, setF] = useState({ entity: '', user: '', page: 1 });
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => get(`/admin/audit?entity=${f.entity}&user=${f.user}&page=${f.page}`) });
  return <div><PageHeader title="Audit log" actions={<div className="flex gap-2"><Input placeholder="Entity type (Lead, User…)" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value, page: 1 })} /><Select value={f.user} onChange={(e) => setF({ ...f, user: e.target.value, page: 1 })}><option value="">Any user</option>{(dir.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></div>} />
    {q.isLoading ? <Spinner /> : <Table head={['When', 'Actor', 'Action', 'Entity', 'Change']} rows={(q.data?.data ?? []).map((a: any) => [dt(a.at), `${userName(dir.data, a.actorUserId)} (${a.actorRole ?? '-'})`, <code key="a" className="text-[12px]">{a.action}</code>, `${a.entityType ?? ''} ${a.entityId ? '…' + String(a.entityId).slice(-6) : ''}`, <details key="d"><summary className="cursor-pointer text-[12px] text-accent">diff</summary><pre className="max-w-[420px] overflow-auto text-[11px]">{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details>])} />}
    <Pager page={f.page} total={q.data?.meta?.total ?? 0} pageSize={50} onPage={(p) => setF({ ...f, page: p })} /></div>;
}
export function MessagesCentre() {
  const [f, setF] = useState({ channel: '', status: '', page: 1 });
  const q = useQuery({ queryKey: ['messages', f], queryFn: () => get(`/admin/messages?channel=${f.channel}&status=${f.status}&page=${f.page}`) });
  const col = (s: string) => (s === 'read' ? 'green' : s === 'delivered' ? 'blue' : s === 'failed' ? 'red' : s === 'queued' ? 'amber' : 'gray') as any;
  return <div><PageHeader title="Notification centre" sub="Every outbound message with provider status" actions={<div className="flex gap-2"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value, page: 1 })}><option value="">All channels</option>{['email', 'whatsapp', 'sms', 'manual_call', 'manual_whatsapp', 'manual_email'].map((c) => <option key={c}>{c}</option>)}</Select><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">All statuses</option>{['queued', 'sent', 'delivered', 'read', 'failed', 'logged'].map((c) => <option key={c}>{c}</option>)}</Select></div>} />
    {q.isLoading ? <Spinner /> : <Table head={['When', 'Lead', 'Channel', 'Template', 'To', 'Status', 'Body']} rows={(q.data?.data ?? []).map((m: any) => [dt(m.queuedAt), m.lead ? <Link key="l" className="text-accent hover:underline" href={`/admin/leads/${m.leadId}`}>{m.lead.client?.name ?? m.lead.client?.phone}</Link> : '—', m.channel, m.templateKey ?? '—', m.to, <Chip key="s" color={col(m.status)}>{m.status}{m.holdUntil && m.status === 'queued' ? ' (quiet hours)' : ''}</Chip>, <span key="b" className="block max-w-[260px] truncate text-[12px] text-mute" title={m.body}>{m.body}</span>])} />}
    <Pager page={f.page} total={q.data?.meta?.total ?? 0} pageSize={50} onPage={(p) => setF({ ...f, page: p })} /></div>;
}
export function LostLeads() {
  const dir = useDirectory(); const { confirm, el } = useConfirm();
  const q = useQuery({ queryKey: ['lost'], queryFn: () => get('/admin/lost-leads').then((r) => r.data as any[]) });
  const statuses = useQuery({ queryKey: ['statuses'], queryFn: () => get('/statuses').then((r) => r.data as any[]) });
  const [re, setRe] = useState<any>(null); const [userId, setUserId] = useState(''); const [statusId, setStatusId] = useState('');
  const engineers = (dir.data ?? []).filter((u) => u.role === 'engineer');
  const act = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast(msg); setRe(null); q.refetch(); } catch (e) { errToast(e); } };
  return <div><PageHeader title="Lost leads" sub="Reassign (full history kept), archive, or delete the lead (never the client)" />
    {q.isLoading ? <Spinner /> : <Table head={['Client', 'Lost by', 'Reason', 'Engineer', 'Lead date', '']} rows={(q.data ?? []).map((l) => [<Link key="n" className="text-accent hover:underline" href={`/admin/leads/${l.id}`}>{l.client?.name ?? l.client?.phone}</Link>, l.lostByRole ?? '—', l.lostReason, userName(dir.data, l.engineerUserId), dd(l.leadDate), <div key="a" className="flex gap-1"><Button variant="ghost" className="h-8" onClick={() => { setRe(l); setUserId(l.engineerUserId ?? ''); }}>Reassign / revive</Button><Button variant="ghost" className="h-8" onClick={() => act(() => post(`/leads/${l.id}/archive`), 'Archived')}>Archive</Button><Button variant="ghost" className="h-8 text-red-700" onClick={async () => { if (await confirm('Delete lead?', 'This hard-deletes the lead (history, quotes, meetings). The client record is kept.')) act(() => post(`/leads/${l.id}/delete`), 'Deleted'); }}>Delete</Button></div>])} empty="No lost leads" />}
    <Dialog open={!!re} onClose={() => setRe(null)} title="Reassign & revive">{re && <div className="space-y-3"><Select label="Engineer" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Keep</option>{engineers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select><Select label="Revive to status" value={statusId} onChange={(e) => setStatusId(e.target.value)}><option value="">Don't revive</option>{(statuses.data ?? []).filter((s) => s.dashboard === (re.transferredToEngineerAt ? 'engineer' : 'sales') && !s.isSystem && s.key !== 'lost').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select><div className="flex justify-end"><Button onClick={() => act(async () => { if (userId && userId !== re.engineerUserId) await post(`/leads/${re.id}/reassign`, { role: 'engineer', userId }); if (statusId) await post(`/leads/${re.id}/revive`, { statusId }); }, 'Updated')}>Apply</Button></div></div>}</Dialog>{el}</div>;
}
export function ClientsMaster() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['clients', q], queryFn: () => get(`/clients?q=${encodeURIComponent(q)}`).then((r) => r.data as any[]) });
  return <div><PageHeader title="Clients" actions={<Input placeholder="Search name / phone" value={q} onChange={(e) => setQ(e.target.value)} />} />
    {list.isLoading ? <Spinner /> : <Table head={['Name', 'Phone', 'Email', 'Area', 'Leads', 'Since']} rows={(list.data ?? []).map((c) => [<Link key="n" className={cn('text-accent hover:underline', c.deletedAt && 'line-through')} href={`/admin/clients/${c.id}`}>{c.name ?? 'Unnamed'}</Link>, c.phone, c.email ?? '—', c.locationArea ?? '—', c._count.leads, dd(c.createdAt)])} />}</div>;
}
export function ClientDetail({ id }: { id: string }) {
  const { confirm, el } = useConfirm();
  const q = useQuery({ queryKey: ['client', id], queryFn: () => get(`/clients/${id}`).then((r) => r.data) });
  if (q.isLoading) return <Spinner />; const c = q.data;
  const remove = async () => { const v = await confirm('Delete client', 'Type the client phone to confirm. This is a manual, admin-only soft delete.', c.phone); if (v) { try { await del(`/clients/${id}`, { confirmation: v }); toast('Client deleted'); q.refetch(); } catch (e) { errToast(e); } } };
  return <div><PageHeader title={c.name ?? 'Unnamed client'} sub={c.phone} actions={<Button variant="danger" onClick={remove}>Delete client</Button>} />
    <div className="grid gap-4 lg:grid-cols-3"><Glass className="grid grid-cols-2 gap-3"><KV k="Email" v={c.email} /><KV k="Area" v={c.locationArea} /><KV k="Address" v={c.exactAddress} /><KV k="Gender" v={c.gender} /><KV k="Ethnicity" v={c.ethnicity} /><KV k="Deleted" v={c.deletedAt ? dt(c.deletedAt) : 'no'} /></Glass>
      <div className="lg:col-span-2"><Table head={['Lead', 'Source', 'Status', 'Stage', 'Date', '']} rows={(c.leads ?? []).map((l: any) => [<Link key="l" className="text-accent hover:underline" href={`/admin/leads/${l.id}`}>{l.requirement ?? 'Lead'}</Link>, l.source, <StatusChip key="s" status={l.engineerStatus ?? l.salesStatus} />, <StageBadge key="st" stage={l.stage} />, dd(l.leadDate), <a key="z" className="text-[12px] text-accent" href={fileUrl(`/leads/${l.id}/export.zip`)}>ZIP</a>])} /></div></div>{el}</div>;
}
export function AdminsPage() {
  const q = useQuery({ queryKey: ['admins'], queryFn: () => get('/admin/admins').then((r) => r.data as any[]) });
  const dashes = ['global', 'sales', 'engineer', 'finance', 'design_head', 'junior_designer'];
  const [edit, setEdit] = useState<any>(null); const [perms, setPerms] = useState<any[]>([]);
  const open = (u: any) => { setEdit(u); setPerms(dashes.map((d) => u.permissions.find((p: any) => p.dashboard === d) ?? { dashboard: d, level: 'none', canApprove: false })); };
  const save = async () => { try { await put(`/admin/permissions/${edit.id}`, perms); toast('Permissions saved'); setEdit(null); q.refetch(); } catch (e) { errToast(e); } };
  return <div><PageHeader title="Admins" sub="Per-dashboard permission level and approval rights" />
    {q.isLoading ? <Spinner /> : <Table head={['Name', 'Email', 'Permissions', '']} rows={(q.data ?? []).map((u) => [u.name, u.email, <div key="p" className="flex flex-wrap gap-1">{u.permissions.map((p: any) => <Chip key={p.id} color={p.level === 'full' ? 'green' : p.level === 'read' ? 'blue' : 'gray'}>{p.dashboard}: {p.level}{p.canApprove ? ' ✓approve' : ''}</Chip>)}</div>, <Button key="e" variant="ghost" className="h-8" onClick={() => open(u)}>Edit</Button>])} />}
    <UsersAdmin role="admin" />
    <Dialog open={!!edit} onClose={() => setEdit(null)} title={`Permissions · ${edit?.name}`}><div className="space-y-2">{perms.map((p, i) => <div key={p.dashboard} className="grid grid-cols-3 items-center gap-2 text-[13px]"><span>{title(p.dashboard)}</span><select className="field h-8" value={p.level} onChange={(e) => setPerms(perms.map((x, j) => (j === i ? { ...x, level: e.target.value } : x)))}><option value="none">none</option><option value="read">read</option><option value="full">full</option></select><Toggle checked={p.canApprove} onChange={(v) => setPerms(perms.map((x, j) => (j === i ? { ...x, canApprove: v } : x)))} label="Can approve" /></div>)}<div className="flex justify-end"><Button onClick={save}>Save</Button></div></div></Dialog></div>;
}
export function ReportsPage() {
  const q = useQuery({ queryKey: ['schedules'], queryFn: () => get('/admin/report-schedules').then((r) => r.data as any[]) });
  const [f, setF] = useState({ dashboard: 'sales', frequency: 'weekly', recipients: '', reportKeys: [] as string[] });
  const add = async () => { try { await post('/admin/report-schedules', { ...f, recipients: f.recipients.split(',').map((s) => s.trim()).filter(Boolean) }); toast('Schedule added'); q.refetch(); } catch (e) { errToast(e); } };
  const dashes = ['sales', 'engineer', 'finance', 'design_head', 'global'];
  return <div><PageHeader title="Reports" sub="Download CSVs or schedule emailed digests" />
    <Glass className="mb-4"><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Download</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{REPORT_KEYS.map((k) => <div key={k} className="flex items-center justify-between rounded-xl bg-white/40 px-3 py-1.5 text-[13px]"><span>{title(k)}</span><div className="flex gap-1">{dashes.map((d) => <a key={d} className="text-[11px] text-accent hover:underline" href={fileUrl(`/reports/${k}.csv?dashboard=${d}`)}>{d.slice(0, 3)}</a>)}</div></div>)}</div></Glass>
    <Glass className="mb-4"><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">New schedule</div><div className="grid gap-2 sm:grid-cols-4"><Select value={f.dashboard} onChange={(e) => setF({ ...f, dashboard: e.target.value })}>{dashes.map((d) => <option key={d}>{d}</option>)}</Select><Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}><option>daily</option><option>weekly</option><option>monthly</option></Select><Input placeholder="emails, comma separated" value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} /><Button disabled={!f.recipients || !f.reportKeys.length} onClick={add}>Add</Button></div><div className="mt-2 flex flex-wrap gap-1">{REPORT_KEYS.map((k) => <button key={k} onClick={() => setF({ ...f, reportKeys: f.reportKeys.includes(k) ? f.reportKeys.filter((x) => x !== k) : [...f.reportKeys, k] })} className={cn('chip', f.reportKeys.includes(k) ? 'border-accent/30 bg-accent/10 text-accent' : 'border-ink/10 bg-white/50')}>{title(k)}</button>)}</div></Glass>
    {q.isLoading ? <Spinner /> : <Table head={['Dashboard', 'Frequency', 'Recipients', 'Reports', 'Last run', 'Active']} rows={(q.data ?? []).map((s) => [s.dashboard, s.frequency, s.recipients.join(', '), s.reportKeys.map(title).join(', '), s.lastRunAt ? dt(s.lastRunAt) : 'never', <Toggle key="a" checked={s.active} onChange={async (v) => { await patch(`/admin/report-schedules/${s.id}`, { active: v }); q.refetch(); }} />])} empty="No schedules" />}</div>;
}
export function ViewAs({ userId }: { userId: string }) {
  const dir = useDirectory(); const u = dir.data?.find((x) => x.id === userId);
  const [path, setPath] = useState('leads');
  const q = useQuery({ queryKey: ['view-as', userId, path], queryFn: () => get(`/admin/view-as/${userId}/${path}`) });
  return <div><PageHeader title={`Viewing as ${u?.name ?? '…'}`} sub="Read-only proxy · every view is written to the audit log" actions={<div className="flex gap-1">{['leads', 'followups?me=1', 'approvals?mine=1', 'delays?mine=1', 'notifications', 'stats'].map((p) => <button key={p} onClick={() => setPath(p)} className={cn('chip', path === p ? 'border-accent/30 bg-accent/10 text-accent' : 'border-ink/10 bg-white/50')}>{p.split('?')[0]}</button>)}</div>} />
    {q.isLoading ? <Spinner /> : <Glass><pre className="max-h-[70vh] overflow-auto text-[12px]">{JSON.stringify(q.data?.data, null, 2)}</pre></Glass>}</div>;
}

/* ---------- AiChat (streaming + citation chips) ---------- */
export function AiChat() {
  const [msgs, setMsgs] = useState<Array<{ role: 'user' | 'assistant'; text: string; citations?: any[] }>>([]);
  const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const sid = useRef(`s_${Date.now()}`); const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [msgs]);
  const send = async () => {
    const q = input.trim(); if (!q) return; setInput(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: q }, { role: 'assistant', text: '' }]);
    try {
      const res = await fetch('/api/v1/admin/ai/chat', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid.current, message: q }) });
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const p of parts) { if (!p.startsWith('data: ')) continue; const ev = JSON.parse(p.slice(6)); setMsgs((m) => { const last = { ...m[m.length - 1] }; if (ev.type === 'delta') last.text += ev.delta; if (ev.type === 'citations') last.citations = ev.citations; return [...m.slice(0, -1), last]; }); } }
    } catch (e) { errToast(e); } finally { setBusy(false); }
  };
  return <div className="mx-auto flex h-[calc(100vh-140px)] max-w-3xl flex-col"><PageHeader title="AI assistant" sub="Answers from MoMs, transcripts, notes, quotes and messages — always with citations" />
    <Glass className="flex-1 space-y-3 overflow-y-auto">{!msgs.length && <Empty text="Ask e.g. “What did Rahul say about budget?” or “Which quotes are waiting approval?”" />}{msgs.map((m, i) => <div key={i} className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px]', m.role === 'user' ? 'ml-auto bg-accent text-white' : 'bg-white/70')}><div className="whitespace-pre-wrap">{m.text || (busy && i === msgs.length - 1 ? '…' : '')}</div>{m.citations && m.citations.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{m.citations.map((c: any, j: number) => <Link key={j} href={c.leadId ? `/admin/leads/${c.leadId}` : '#'} title={c.quotedLine} className="chip border-accent/20 bg-accent/5 text-[11px] text-accent">{c.docType}{c.versionNo ? ` v${c.versionNo}` : ''} · {c.clientName ?? 'lead'}{c.meetingDate ? ` · ${c.meetingDate}` : ''}</Link>)}</div>}</div>)}<div ref={bottom} /></Glass>
    <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}><input className="field" placeholder="Ask a question…" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} /><Button type="submit" loading={busy}>Send</Button></form></div>;
}
