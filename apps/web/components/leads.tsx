'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Phone, Mail, MessageCircle, Paperclip, Trash2, Upload } from 'lucide-react';
import { get, post, put, patch, del, fileUrl, ApiError } from '@/lib/api';
import { useDirectory, useInvalidate, useMe, useSources, useStatuses, userName } from '@/lib/hooks';
import { dt, ago, title, inr, toLocalInput, fromLocalInput } from '@/lib/format';
import { toast, errToast } from '@/lib/store';
import { queueOrSend } from '@/lib/offline';
import { Button, Chip, Dialog, Empty, Glass, Input, KV, Pager, RuleButton, Select, Spinner, StageBadge, StatusChip, Table, Textarea, Toggle, cn, useConfirm } from './ui';

export const leadHref = (role: string, id: string) => `/${role === 'design_head' || role === 'junior_designer' ? 'design' : role}/leads/${id}`;

/* ---------- LeadTable (every list: pagination, filters, CSV) ---------- */
export function LeadsList({ dashboard, basePath, title: t = 'Leads', extraQuery = '' }: { dashboard: string; basePath: string; title?: string; extraQuery?: string }) {
  const sp = useSearchParams(); const r = useRouter();
  const [q, setQ] = useState(sp.get('q') ?? ''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  useEffect(() => setQ(sp.get('q') ?? ''), [sp]);
  const statuses = useStatuses();
  const key = ['leads', dashboard, q, status, page, extraQuery];
  const leads = useQuery({ queryKey: key, queryFn: () => get(`/leads?dashboard=${dashboard}&q=${encodeURIComponent(q)}&status=${status}&page=${page}${extraQuery}`) });
  const rows = (leads.data?.data ?? []) as any[];
  const dashStatuses = (statuses.data ?? []).filter((s) => s.dashboard === (dashboard === 'sales' ? 'sales' : 'engineer'));
  return <div>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-[22px] font-semibold tracking-tight">{t}</h1>
      <div className="flex flex-wrap gap-2">
        <input className="field h-9 w-56" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="field h-9 w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{dashStatuses.map((s: any) => <option key={s.id} value={s.key}>{s.label}</option>)}</select>
        <a className="btn-ghost" href={fileUrl(`/reports/leads_by_status.csv?dashboard=${dashboard}`)}><Download className="h-4 w-4" />CSV</a>
        {dashboard === 'sales' && <Link href="/sales/leads/new" className="btn-primary">New lead</Link>}
      </div>
    </div>
    {leads.isLoading ? <Spinner /> : <Table head={['Client', 'Phone', 'Source', 'Status', 'Stage', 'Updated']} rows={rows.map((l) => [
      <Link key="n" href={`${basePath}/${l.id}`} className="font-medium text-white hover:underline">{l.client?.name ?? l.clientName ?? 'Unnamed'}</Link>,
      l.client?.phone ?? <span className="text-mute">hidden</span>, l.source, <StatusChip key="s" status={l.engineerStatus ?? l.salesStatus} />, <StageBadge key="st" stage={l.stage} />, ago(l.leadDate),
    ])} empty="No leads match" />}
    <Pager page={page} total={leads.data?.meta?.total ?? 0} pageSize={25} onPage={setPage} />
  </div>;
}

/* ---------- New lead + DuplicateDialog (9.1) ---------- */
export function NewLeadForm() {
  const r = useRouter(); const sources = useSources(); const inv = useInvalidate();
  const [f, setF] = useState<any>({ phone: '', name: '', email: '', locationArea: '', ethnicity: '', gender: '', requirement: '', sourceId: '' });
  const [dup, setDup] = useState<any>(null); const [busy, setBusy] = useState(false); const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (!f.sourceId && sources.data?.[0]) setF((x: any) => ({ ...x, sourceId: sources.data[0].id })); }, [sources.data, f.sourceId]);
  const set = (k: string) => (e: any) => setF((x: any) => ({ ...x, [k]: e.target.value }));
  const payload = () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  const submit = async (e: any) => {
    e.preventDefault(); setErrs({});
    if (!/^\+?[0-9]{10,15}$/.test(f.phone)) return setErrs({ phone: 'Enter 10–15 digits' });
    setBusy(true);
    try { const res = await post('/leads', payload()); inv('leads'); toast('Lead created'); r.push(`/sales/leads/${res.data.id}`); }
    catch (err: any) { if (err instanceof ApiError && err.code === 'DUPLICATE') setDup(err.details.existingClient); else errToast(err); }
    finally { setBusy(false); }
  };
  const override = async () => { try { await post('/leads/duplicate-override', payload()); toast('Override requested — waiting for admin'); setDup(null); r.push('/sales/approvals'); } catch (e) { errToast(e); } };
  return <form onSubmit={submit} className="mx-auto max-w-xl">
    <h1 className="mb-4 text-[22px] font-semibold tracking-tight">New lead</h1>
    <Glass className="grid gap-3 sm:grid-cols-2">
      <Input label="Phone *" value={f.phone} onChange={set('phone')} placeholder="+91…" error={errs.phone} required />
      <UnknownField label="Name" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
      <Input label="Email" type="email" value={f.email} onChange={set('email')} />
      <UnknownField label="Location / area" value={f.locationArea} onChange={(v) => setF({ ...f, locationArea: v })} />
      <UnknownField label="Ethnicity" value={f.ethnicity} onChange={(v) => setF({ ...f, ethnicity: v })} />
      <Select label="Gender" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="Unknown">Unknown</option><option>female</option><option>male</option><option>other</option></Select>
      <Select label="Source *" value={f.sourceId} onChange={set('sourceId')}>{(sources.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
      <div className="sm:col-span-2"><Textarea label="Requirement" value={f.requirement} onChange={set('requirement')} /></div>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={() => r.back()}>Cancel</Button><Button type="submit" loading={busy}>Create lead</Button></div>
    </Glass>
    <Dialog open={!!dup} onClose={() => setDup(null)} title="Duplicate client">
      {dup && <div className="space-y-3 text-[13.5px]"><p>A client with this phone already exists.</p>
        <div className="glass-soft grid grid-cols-2 gap-3 p-3"><KV k="Name" v={dup.name} /><KV k="Leads" v={dup.leadCount} /><KV k="Last status" v={dup.lastStatus} /><KV k="Last lead" v={dt(dup.lastLeadDate)} /></div>
        <p className="text-mute">You can request an override; Admin approval creates a new lead linked to the previous one.</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDup(null)}>Close</Button><Button onClick={override}>Request override</Button></div></div>}
    </Dialog>
  </form>;
}

/** Text field with a one-tap "Unknown" (spec: name / area / ethnicity / gender each with Unknown). */
function UnknownField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="block"><span className="label">{label}</span><span className="flex gap-1"><input className="field" value={value} onChange={(e) => onChange(e.target.value)} /><button type="button" className={cn('btn-ghost h-9 px-2 text-[12px]', value === 'Unknown' && 'border-white/40 text-white')} onClick={() => onChange(value === 'Unknown' ? '' : 'Unknown')}>Unknown</button></span></label>;
}

/* ---------- LeadHeader ---------- */
export function LeadHeader({ lead, onChanged, children }: { lead: any; onChanged: () => void; children?: React.ReactNode }) {
  const me = useMe()!; const role = me.user.role;
  const [statusOpen, setStatusOpen] = useState(false); const [contactOpen, setContactOpen] = useState(false); const [closeOpen, setCloseOpen] = useState(false);
  const closeProject = async (keep: boolean) => { try { await post(`/leads/${lead.id}/close-project`, { keepRecordings: keep }); toast(keep ? 'Project closed · recordings kept' : 'Project closed · recordings deleted, text kept'); setCloseOpen(false); onChanged(); } catch (e) { errToast(e); } };
  const canStatus = (role === 'sales' && !lead.transferredToEngineerAt) || (role === 'engineer' && lead.transferredToEngineerAt && !lead.handoverCompletedAt);
  return <div className="glass mb-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-[20px] font-semibold tracking-tight">{lead.client?.name ?? 'Unnamed client'}</h1><StageBadge stage={lead.stage} /></div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-mute">
          {lead.client?.phone && <a href={`tel:${lead.client.phone}`} className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{lead.client.phone}</a>}
          {lead.client?.email && <a href={`mailto:${lead.client.email}`} className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{lead.client.email}</a>}
          <span>{lead.source}</span>{lead.client?.locationArea && <span>{lead.client.locationArea}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {lead.salesStatus && <div className="text-[12px] text-mute">Sales <StatusChip status={lead.salesStatus} /></div>}
        {lead.engineerStatus && <div className="text-[12px] text-mute">Engineer <StatusChip status={lead.engineerStatus} /></div>}
        {canStatus && <Button variant="ghost" onClick={() => setStatusOpen(true)}>Change status</Button>}
        {['sales', 'engineer', 'finance'].includes(role) && <Button variant="ghost" onClick={() => setContactOpen(true)}><MessageCircle className="h-4 w-4" />Log contact</Button>}
        {role === 'admin' && !lead.projectClosedAt && <Button variant="ghost" onClick={() => setCloseOpen(true)}>Close project</Button>}
        {lead.projectClosedAt && <Chip color="gray">closed · recordings {lead.recordingsKept ? 'kept' : 'deleted'}</Chip>}
        {children}
      </div>
    </div>
    <StatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} lead={lead} dashboard={role === 'sales' ? 'sales' : 'engineer'} onChanged={onChanged} />
    <LogContactDialog open={contactOpen} onClose={() => setContactOpen(false)} leadId={lead.id} onChanged={onChanged} />
    <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} title="Close project"><p className="text-[13.5px]">Closing archives the lead. Recordings are kept until you decide here; transcripts, minutes and documents are always kept.</p><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => closeProject(true)}>Close · keep recordings</Button><Button variant="danger" onClick={() => closeProject(false)}>Close · delete recordings</Button></div></Dialog>
  </div>;
}

/* ---------- StatusSelect (enforces follow-up date/reason, rule 9.3) ---------- */
export function StatusDialog({ open, onClose, lead, dashboard, onChanged }: { open: boolean; onClose: () => void; lead: any; dashboard: 'sales' | 'engineer'; onChanged: () => void }) {
  const statuses = useStatuses();
  const list = (statuses.data ?? []).filter((s: any) => s.dashboard === dashboard && (!s.isSystem || s.key === 'quote_approved_payment'));
  const [statusId, setStatusId] = useState(''); const [reason, setReason] = useState(''); const [followUpAt, setFollowUpAt] = useState(toLocalInput(new Date(Date.now() + 86400000))); const [priority, setPriority] = useState('med'); const [busy, setBusy] = useState(false);
  const st = list.find((s: any) => s.id === statusId);
  const submit = async () => {
    setBusy(true);
    try { const r: any = await queueOrSend('status change', 'POST', `/leads/${lead.id}/status`, { statusId, reason: reason || undefined, followUpAt: st?.requiresFollowUp ? fromLocalInput(followUpAt) : undefined, priority: st?.requiresFollowUp ? priority : undefined }); toast(r?.queued ? 'Queued (offline)' : 'Status updated'); onChanged(); onClose(); }
    catch (e) { errToast(e); } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title={`${title(dashboard)} status`}>
    <div className="space-y-3">
      <Select label="Status" value={statusId} onChange={(e) => setStatusId(e.target.value)}><option value="">Select…</option>{list.map((s: any) => <option key={s.id} value={s.id}>{s.label}{s.requiresFollowUp ? ' · follow-up required' : ''}{s.key === 'lost' ? ' · reason required' : ''}</option>)}</Select>
      {st?.requiresFollowUp && <div className="grid grid-cols-2 gap-3"><Input type="datetime-local" label="Follow-up at *" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} /><Select label="Priority *" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></Select></div>}
      <Textarea label={st?.key === 'lost' ? 'Reason *' : 'Reason / note'} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><RuleButton blocked={!statusId ? 'Pick a status' : st?.key === 'lost' && !reason.trim() ? 'Lost requires a reason' : null} loading={busy} onClick={submit}>Save</RuleButton></div>
    </div>
  </Dialog>;
}

export function LogContactDialog({ open, onClose, leadId, onChanged }: { open: boolean; onClose: () => void; leadId: string; onChanged: () => void }) {
  const [channel, setChannel] = useState('manual_call'); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { const r: any = await queueOrSend('log contact', 'POST', `/leads/${leadId}/log-contact`, { channel, note }); toast(r?.queued ? 'Queued (offline)' : 'Logged'); setNote(''); onChanged(); onClose(); } catch (e) { errToast(e); } finally { setBusy(false); } };
  return <Dialog open={open} onClose={onClose} title="Log a contact"><div className="space-y-3">
    <Select label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="manual_call">Call</option><option value="manual_whatsapp">WhatsApp</option><option value="manual_email">Email</option></Select>
    <Textarea label="Note *" value={note} onChange={(e) => setNote(e.target.value)} />
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!note.trim()} onClick={submit}>Save</Button></div></div></Dialog>;
}

/* ---------- Overview / editable fields ---------- */
export function LeadOverview({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const me = useMe()!; const role = me.user.role; const dir = useDirectory();
  const editable = (role === 'engineer' && lead.transferredToEngineerAt) || (role === 'sales' && !lead.transferredToEngineerAt);
  const [f, setF] = useState<any>({ name: lead.client?.name ?? '', gender: lead.client?.gender ?? '', exactAddress: lead.client?.exactAddress ?? '', requirement: lead.requirement ?? '', budget: lead.budget ?? '' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await patch(`/leads/${lead.id}`, { name: f.name, gender: f.gender, exactAddress: f.exactAddress, requirement: f.requirement, budget: f.budget === '' ? null : Number(f.budget) }); toast('Saved'); onChanged(); } catch (e) { errToast(e); } finally { setBusy(false); } };
  const genuine = async (v: boolean) => { try { await post(`/leads/${lead.id}/genuine`, { genuine: v }); onChanged(); } catch (e) { errToast(e); } };
  const transfer = async () => { try { await post(`/leads/${lead.id}/transfer-to-engineer`, {}); toast('Transferred to engineer'); onChanged(); } catch (e) { errToast(e); } };
  const followUps = lead.followUps ?? [];
  return <div className="grid gap-4 lg:grid-cols-3">
    <Glass className="lg:col-span-2">
      <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Details</div>
      {editable ? <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select label="Gender" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">—</option><option>female</option><option>male</option><option>other</option></Select>
        <Input label="Exact address (geocoded for site check-in)" value={f.exactAddress} onChange={(e) => setF({ ...f, exactAddress: e.target.value })} className="sm:col-span-2" />
        <Input label="Budget (₹)" type="number" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
        <div className="sm:col-span-2"><Textarea label="Requirement" value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })} /></div>
        <div className="flex justify-end sm:col-span-2"><Button loading={busy} onClick={save}>Save</Button></div>
      </div> : <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KV k="Requirement" v={lead.requirement} /><KV k="Budget" v={lead.budget ? inr(lead.budget) : '—'} /><KV k="Address" v={lead.client?.exactAddress} /><KV k="Gender" v={lead.client?.gender} /><KV k="Lead date" v={dt(lead.leadDate)} /><KV k="Sales" v={userName(dir.data, lead.salesUserId)} /><KV k="Engineer" v={userName(dir.data, lead.engineerUserId)} />
      </div>}
      {lead.aiProfile && role !== 'finance' && <div className="mt-4 rounded-xl border border-white/15 bg-white/[.06] p-3 text-[13px]"><div className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-white">AI client profile</div><div className="whitespace-pre-wrap">{lead.aiProfile}</div></div>}
    </Glass>
    <div className="space-y-4">
      {role === 'sales' && !lead.transferredToEngineerAt && <Glass>
        <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Qualification</div>
        <Toggle checked={!!lead.genuine} onChange={genuine} label="Genuine lead" />
        <div className="mt-4"><RuleButton className="w-full" blocked={lead.salesStatus?.key !== 'seems_positive' || !lead.genuine ? 'Transfer requires Seems positive + Genuine' : null} onClick={transfer}>Transfer to engineer</RuleButton></div>
      </Glass>}
      {lead.transferredToEngineerAt && role === 'sales' && <Glass><div className="text-[13px] text-mute">Transferred {ago(lead.transferredToEngineerAt)} · read-only</div></Glass>}
      {followUps.length > 0 && <Glass><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Open follow-ups</div>{followUps.map((f: any) => <div key={f.id} className="flex items-center justify-between py-1 text-[13px]"><span>{dt(f.dueAt)}</span><Chip color={f.priority === 'high' ? 'red' : f.priority === 'med' ? 'amber' : 'gray'}>{f.priority}</Chip></div>)}</Glass>}
      {lead.lostReason && <Glass className="border-red-300/40"><div className="text-[12px] font-medium uppercase tracking-wide text-red-300">Lost</div><div className="text-[13px]">{lead.lostReason}</div></Glass>}
    </div>
  </div>;
}

/* ---------- Billing ---------- */
export function BillingForm({ lead, onChanged, readOnly }: { lead: any; onChanged: () => void; readOnly?: boolean }) {
  const b = lead.billing ?? {};
  const [f, setF] = useState<any>({ legalName: b.legalName ?? '', billingAddress: b.billingAddress ?? '', state: b.state ?? '', gstin: b.gstin ?? '', pan: b.pan ?? '', siteAddress: b.siteAddress ?? lead.client?.exactAddress ?? '', contactName: b.contactName ?? lead.client?.name ?? '', contactPhone: b.contactPhone ?? lead.client?.phone ?? '', contactEmail: b.contactEmail ?? lead.client?.email ?? '' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await put(`/leads/${lead.id}/billing`, { ...f, gstin: f.gstin || undefined, pan: f.pan || undefined }); toast('Billing saved'); onChanged(); } catch (e) { errToast(e); } finally { setBusy(false); } };
  const F = (k: string, label: string, extra: any = {}) => <Input label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={readOnly} {...extra} />;
  return <Glass className="grid gap-3 sm:grid-cols-2">{F('legalName', 'Legal name *')}{F('state', 'State * (GST place of supply)')}<div className="sm:col-span-2">{F('billingAddress', 'Billing address *')}</div>{F('gstin', 'GSTIN')}{F('pan', 'PAN')}<div className="sm:col-span-2">{F('siteAddress', 'Site address *')}</div>{F('contactName', 'Contact name *')}{F('contactPhone', 'Contact phone *')}{F('contactEmail', 'Contact email *', { type: 'email' })}{!readOnly && <div className="flex justify-end sm:col-span-2"><Button loading={busy} onClick={save}>Save billing</Button></div>}</Glass>;
}

/* ---------- Timeline ---------- */
export function Timeline({ leadId }: { leadId: string }) {
  const dir = useDirectory();
  const q = useQuery({ queryKey: ['timeline', leadId], queryFn: () => get(`/leads/${leadId}/timeline`).then((r) => r.data as any[]) });
  if (q.isLoading) return <Spinner />;
  const color: Record<string, string> = { status: 'bg-white', message: 'bg-blue-300', meeting: 'bg-violet-400', note: 'bg-amber-400', file: 'bg-emerald-400', approval: 'bg-pink-300' };
  return <Glass>{!q.data?.length ? <Empty text="No activity yet" /> : <ol className="relative ml-2 border-l border-white/15">{q.data.map((it, i) => <li key={i} className="mb-4 ml-4"><span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${color[it.type] ?? 'bg-ink/30'}`} /><div className="text-[13.5px] font-medium">{it.title}</div>{it.detail && <div className="whitespace-pre-wrap text-[13px] text-ink/90">{it.detail}</div>}<div className="text-[11.5px] text-mute">{dt(it.at)}{it.byUserId && ` · ${userName(dir.data, it.byUserId)}`}</div></li>)}</ol>}</Glass>;
}

/* ---------- Notes & Files ---------- */
export function NotesPanel({ leadId, meetingId }: { leadId: string; meetingId?: string }) {
  const dir = useDirectory(); const inv = useInvalidate();
  const q = useQuery({ queryKey: ['notes', leadId], queryFn: () => get(`/leads/${leadId}/notes`).then((r) => r.data as any[]) });
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const add = async () => { setBusy(true); try { const r: any = await queueOrSend('note', 'POST', `/leads/${leadId}/notes`, { text, meetingId }); toast(r?.queued ? 'Queued (offline)' : 'Note added'); setText(''); q.refetch(); inv('timeline'); } catch (e) { errToast(e); } finally { setBusy(false); } };
  return <Glass><div className="mb-3 flex gap-2"><input className="field" placeholder="Add a note…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && add()} /><Button onClick={add} loading={busy} disabled={!text.trim()}>Add</Button></div>
    {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty text="No notes" /> : <div className="divide-y divide-white/10">{q.data.map((n) => <div key={n.id} className="py-2.5"><div className="whitespace-pre-wrap text-[13.5px]">{n.text}</div><div className="text-[11.5px] text-mute">{userName(dir.data, n.byUserId)} · {ago(n.at)}</div></div>)}</div>}</Glass>;
}
export function FilesPanel({ leadId }: { leadId: string }) {
  const dir = useDirectory();
  const q = useQuery({ queryKey: ['files', leadId], queryFn: () => get(`/leads/${leadId}/files`).then((r) => r.data as any[]) });
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => { setBusy(true); try { const fd = new FormData(); fd.append('file', file); await fetch(`/api/v1/leads/${leadId}/files`, { method: 'POST', body: fd, credentials: 'include' }).then((r) => { if (!r.ok) throw new Error('Upload failed'); }); toast('Uploaded'); q.refetch(); } catch (e) { errToast(e); } finally { setBusy(false); } };
  const open = async (id: string) => { const r = await get(`/leads/${leadId}/files/${id}`); window.open(r.data.url, '_blank'); };
  const remove = async (id: string) => { await del(`/leads/${leadId}/files/${id}`); q.refetch(); };
  return <Glass><label className="btn-ghost mb-3 cursor-pointer"><Upload className="h-4 w-4" />{busy ? 'Uploading…' : 'Upload file'}<input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
    {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty text="No files" /> : <div className="divide-y divide-white/10">{q.data.map((f) => <div key={f.id} className="flex items-center gap-3 py-2 text-[13.5px]"><Paperclip className="h-4 w-4 text-mute" /><button className="flex-1 truncate text-left hover:underline" onClick={() => open(f.id)}>{f.name}</button><span className="text-[12px] text-mute">{(f.bytes / 1024).toFixed(0)} KB · {userName(dir.data, f.byUserId)}</span><button onClick={() => remove(f.id)} className="rounded p-1 text-mute hover:bg-red-400/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button></div>)}</div>}</Glass>;
}
