'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, FileText, Send, Check, Star } from 'lucide-react';
import { computeQuote, type QuoteData, DEFAULT_RATE_CARD } from '@app/shared';
import { get, post, fileUrl } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { inr, dt } from '@/lib/format';
import { toast, errToast } from '@/lib/store';
import { Button, Chip, Dialog, Empty, Glass, Input, RuleButton, Select, Spinner, Toggle, cn } from './ui';

const emptyData = (): QuoteData => ({ propertyType: '2BHK', carpetAreaSqft: 800, locality: '', possession: 'ready', projectType: 'full', package: 'essential', rooms: [{ name: 'Living', items: [] }], services: [], contingencyPct: 5, discountType: 'amount', discountValue: 0, roundOff: true });

/* ---------- QuoteBuilder (Section 7) ---------- */
export function QuoteBuilder({ leadId, open, onClose, onCreated, initial, nextVersion }: { leadId: string; open: boolean; onClose: () => void; onCreated: () => void; initial?: QuoteData; nextVersion: number }) {
  const rc = useQuery({ queryKey: ['rate-card'], queryFn: () => get('/settings/rate-card').then((r) => r.data) });
  const rateCard = rc.data?.rateCard ?? DEFAULT_RATE_CARD; const gstPct = Number(rc.data?.gstPct ?? 18);
  const [d, setD] = useState<QuoteData>(initial ?? emptyData());
  const [schedule, setSchedule] = useState([{ name: 'Advance', pct: 40, trigger: 'On acceptance' }, { name: 'Mid', pct: 40, trigger: 'On site start' }, { name: 'Final', pct: 20, trigger: 'On completion' }]);
  const [approvalRequired, setApprovalRequired] = useState(true); const [isFinal, setIsFinal] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { if (initial) setD(initial); }, [initial]);
  const totals = useMemo(() => { try { return computeQuote(d, Number(rateCard.packages[d.package] ?? 0), gstPct); } catch { return null; } }, [d, rateCard, gstPct]);
  const sum = schedule.reduce((a, m) => a + Number(m.pct || 0), 0);
  const setRoom = (i: number, patch: any) => setD({ ...d, rooms: d.rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addItem = (i: number, key: string) => { const it = rateCard.items.find((x: any) => x.key === key); if (!it) return; setRoom(i, { items: [...d.rooms[i].items, { key: it.key, label: it.label, qty: 1, unit: it.unit, rate: it.rate, rateOverridden: false }] }); };
  const setItem = (i: number, k: number, patch: any) => setRoom(i, { items: d.rooms[i].items.map((it, j) => (j === k ? { ...it, ...patch } : it)) });
  const addService = (key: string) => { const s = rateCard.services.find((x: any) => x.key === key); if (!s || d.services.some((x) => x.key === key)) return; setD({ ...d, services: [...d.services, { key: s.key, label: s.label, mode: s.defaultMode, value: s.defaultValue }] }); };
  const submit = async () => { setBusy(true); try { await post(`/leads/${leadId}/quote/versions`, { data: d, paymentSchedule: schedule, approvalRequired, isFinal }); toast(`Quote v${nextVersion} created`); onCreated(); onClose(); } catch (e) { errToast(e); } finally { setBusy(false); } };
  const mustApprove = nextVersion === 1 || isFinal;
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return <Dialog open={open} onClose={onClose} title={`Quote v${nextVersion}`} wide>
    <div className="space-y-4 text-[13.5px]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Select label="Property" value={d.propertyType} onChange={(e) => setD({ ...d, propertyType: e.target.value as any })}>{['1BHK', '2BHK', '3BHK', '4BHK', 'villa', 'office', 'retail'].map((p) => <option key={p}>{p}</option>)}</Select>
        <Input label="Carpet area (sqft)" type="number" value={d.carpetAreaSqft} onChange={(e) => setD({ ...d, carpetAreaSqft: num(e.target.value) })} />
        <Input label="Locality" value={d.locality} onChange={(e) => setD({ ...d, locality: e.target.value })} />
        <Select label="Possession" value={d.possession} onChange={(e) => setD({ ...d, possession: e.target.value as any })}><option value="ready">Ready</option><option value="under_construction">Under construction</option></Select>
        <Select label="Project" value={d.projectType} onChange={(e) => setD({ ...d, projectType: e.target.value as any })}><option value="full">Full</option><option value="partial">Partial</option><option value="renovation">Renovation</option></Select>
        <Select label={`Package (₹${rateCard.packages[d.package]}/sqft)`} value={d.package} onChange={(e) => setD({ ...d, package: e.target.value as any })}>{Object.keys(rateCard.packages).map((p) => <option key={p}>{p}</option>)}</Select>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><span className="label mb-0">Rooms</span><Button variant="ghost" className="h-8" onClick={() => setD({ ...d, rooms: [...d.rooms, { name: `Room ${d.rooms.length + 1}`, items: [] }] })}><Plus className="h-4 w-4" />Room</Button></div>
        <div className="space-y-2">{d.rooms.map((r, i) => <div key={i} className="glass-soft p-3">
          <div className="mb-2 flex items-center gap-2"><input className="field h-8 w-40" value={r.name} onChange={(e) => setRoom(i, { name: e.target.value })} /><select className="field h-8 w-48" value="" onChange={(e) => addItem(i, e.target.value)}><option value="">+ add item…</option>{rateCard.items.map((it: any) => <option key={it.key} value={it.key}>{it.label} ({it.unit})</option>)}</select><button className="ml-auto text-mute hover:text-red-600" onClick={() => setD({ ...d, rooms: d.rooms.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button></div>
          {r.items.map((it, k) => { const card = rateCard.items.find((x: any) => x.key === it.key); return <div key={k} className="mb-1 grid grid-cols-12 items-center gap-2 text-[13px]"><span className="col-span-4 truncate">{it.label}</span><input type="number" className="field col-span-2 h-8" value={it.qty} onChange={(e) => setItem(i, k, { qty: num(e.target.value) })} /><span className="col-span-1 text-mute">{it.unit}</span><input type="number" className={cn('field col-span-2 h-8', it.rateOverridden && 'border-amber-400')} value={it.rate} onChange={(e) => setItem(i, k, { rate: num(e.target.value), rateOverridden: num(e.target.value) !== card?.rate })} />{it.rateOverridden ? <input className="field col-span-2 h-8" placeholder="override remark" value={it.overrideRemark ?? ''} onChange={(e) => setItem(i, k, { overrideRemark: e.target.value })} /> : <span className="col-span-2 text-right text-mute">{inr(it.qty * it.rate)}</span>}<button className="col-span-1 text-mute hover:text-red-600" onClick={() => setRoom(i, { items: r.items.filter((_, j) => j !== k) })}><Trash2 className="h-4 w-4" /></button></div>; })}
        </div>)}</div>
      </div>
      <div><div className="mb-2 flex items-center justify-between"><span className="label mb-0">Services</span><select className="field h-8 w-48" value="" onChange={(e) => addService(e.target.value)}><option value="">+ add service…</option>{rateCard.services.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
        {d.services.map((s, i) => <div key={s.key} className="mb-1 grid grid-cols-12 items-center gap-2 text-[13px]"><span className="col-span-5">{s.label}</span><select className="field col-span-3 h-8" value={s.mode} onChange={(e) => setD({ ...d, services: d.services.map((x, j) => (j === i ? { ...x, mode: e.target.value as any } : x)) })}><option value="pct">% of works</option><option value="fixed">Fixed ₹</option></select><input type="number" className="field col-span-3 h-8" value={s.value} onChange={(e) => setD({ ...d, services: d.services.map((x, j) => (j === i ? { ...x, value: num(e.target.value) } : x)) })} /><button className="text-mute hover:text-red-600" onClick={() => setD({ ...d, services: d.services.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button></div>)}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Input label="Contingency %" type="number" value={d.contingencyPct} onChange={(e) => setD({ ...d, contingencyPct: num(e.target.value) })} /><Select label="Discount type" value={d.discountType} onChange={(e) => setD({ ...d, discountType: e.target.value as any })}><option value="amount">Amount</option><option value="pct">Percent</option></Select><Input label="Discount" type="number" value={d.discountValue} onChange={(e) => setD({ ...d, discountValue: num(e.target.value) })} /><div className="pt-6"><Toggle checked={d.roundOff} onChange={(v) => setD({ ...d, roundOff: v })} label="Round off" /></div></div>
      <div><div className="mb-2 flex items-center justify-between"><span className="label mb-0">Payment schedule <span className={cn('ml-2 normal-case', Math.abs(sum - 100) > 0.01 ? 'text-red-600' : 'text-emerald-700')}>({sum}%)</span></span><Button variant="ghost" className="h-8" onClick={() => setSchedule([...schedule, { name: '', pct: 0, trigger: '' }])}><Plus className="h-4 w-4" /></Button></div>
        {schedule.map((m, i) => <div key={i} className="mb-1 grid grid-cols-12 gap-2"><input className="field col-span-4 h-8" placeholder="Milestone" value={m.name} onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /><input type="number" className="field col-span-2 h-8" value={m.pct} onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, pct: num(e.target.value) } : x)))} /><input className="field col-span-5 h-8" placeholder="Trigger" value={m.trigger} onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)))} /><button className="text-mute hover:text-red-600" onClick={() => setSchedule(schedule.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></div>)}</div>
      {totals && <div className="glass-soft grid grid-cols-2 gap-2 p-3 text-[13px] sm:grid-cols-4"><div>Base <b>{inr(totals.base)}</b></div><div>Rooms <b>{inr(totals.roomsTotal)}</b></div><div>Services <b>{inr(totals.servicesTotal)}</b></div><div>Contingency <b>{inr(totals.contingency)}</b></div><div>Discount <b>−{inr(totals.discount)}</b></div><div>Subtotal <b>{inr(totals.subtotal)}</b></div><div>GST {gstPct}% <b>{inr(totals.gstAmount)}</b></div><div className="text-accent">Total <b>{inr(totals.total)}</b></div></div>}
      <div className="flex flex-wrap items-center gap-4"><Toggle checked={isFinal} onChange={setIsFinal} label="Mark as final version" /><Toggle checked={mustApprove || approvalRequired} onChange={(v) => !mustApprove && setApprovalRequired(v)} label={mustApprove ? 'Admin approval required (v1 / final)' : 'Request admin approval'} /></div>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><RuleButton blocked={Math.abs(sum - 100) > 0.01 ? 'Payment schedule must sum to 100%' : !totals ? 'Fix inputs' : null} loading={busy} onClick={submit}>Create v{nextVersion}</RuleButton></div>
    </div>
  </Dialog>;
}

/* ---------- QuoteVersionList + DiffView + actions (rules 9.7, 9.8) ---------- */
export function QuotePanel({ lead, onChanged, readOnly }: { lead: any; onChanged: () => void; readOnly?: boolean }) {
  const me = useMe()!; const role = me.user.role;
  const q = useQuery({ queryKey: ['quote', lead.id], queryFn: () => get(`/leads/${lead.id}/quote`).then((r) => r.data) });
  const [open, setOpen] = useState(false); const [diff, setDiff] = useState<any>(null); const [busy, setBusy] = useState(''); const [base, setBase] = useState<QuoteData | undefined>();
  const versions: any[] = q.data?.versions ?? [];
  const nextVersion = (q.data?.currentVersionNo ?? 0) + 1;
  const refresh = () => { q.refetch(); onChanged(); };
  const act = async (k: string, fn: () => Promise<any>, msg?: string) => { setBusy(k); try { await fn(); if (msg) toast(msg); refresh(); } catch (e) { errToast(e); } finally { setBusy(''); } };
  const final = versions.find((v) => v.id === q.data?.finalVersionId);
  const pushBlocked = !final ? 'Mark a version as final' : final.approvalStatus !== 'approved' ? 'Final version needs admin approval' : !final.clientAcceptedAt ? 'Client must accept the final quote' : !lead.billing ? 'Fill billing details' : null;
  const locked = !!lead.pushedToFinanceAt && ['advance_paid', 'pushed_to_design', 'internal_meeting_done', 'second_client_meeting_done', 'handover_accepted'].includes(lead.stage);
  if (q.isLoading) return <Spinner />;
  return <div className="space-y-3">
    {role === 'engineer' && !readOnly && <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={locked} onClick={() => { setBase(versions.at(-1)?.data); setOpen(true); }}><Plus className="h-4 w-4" />New version</Button>
      {!lead.pushedToFinanceAt || lead.engineerStatus?.key === 'asked_quote' ? <RuleButton blocked={pushBlocked} loading={busy === 'push'} onClick={() => act('push', () => post(`/leads/${lead.id}/push-to-finance`), 'Pushed to finance')}>Push to finance</RuleButton> : <Chip color="green">Pushed to finance</Chip>}
    </div>}
    {!versions.length ? <Glass><Empty text="No quote versions yet" /></Glass> : versions.slice().reverse().map((v) => <Glass key={v.id} className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><span className="text-[15px] font-semibold">v{v.versionNo}</span>{v.isFinal && <Chip color="accent"><Star className="h-3 w-3" />final</Chip>}
          <Chip color={v.approvalStatus === 'approved' ? 'green' : v.approvalStatus === 'pending' ? 'amber' : v.approvalStatus === 'rejected' ? 'red' : 'gray'}>{v.approvalStatus.replace('_', ' ')}</Chip>
          {v.sentToClientAt && <Chip color="blue">sent {dt(v.sentToClientAt)}</Chip>}{v.clientAcceptedAt && <Chip color="green"><Check className="h-3 w-3" />accepted</Chip>}{v.clientChangeRequest && <Chip color="amber">changes requested</Chip>}</div>
        <div className="text-right"><div className="text-[16px] font-semibold">{inr(v.total)}</div><div className="text-[12px] text-mute">{inr(v.subtotal)} + GST</div></div>
      </div>
      {v.approvalRemark && <div className="mt-2 text-[13px] text-ink/80">Admin: {v.approvalRemark}</div>}
      {v.clientChangeRequest && <div className="mt-2 rounded-lg bg-amber-50 p-2 text-[13px] text-amber-900">Client: {v.clientChangeRequest}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {(!readOnly || v.isFinal) && <a className="btn-ghost h-8" href={fileUrl(`/quote-versions/${v.id}/pdf`)} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" />PDF</a>}
        {!readOnly && v.versionNo > 1 && <Button variant="ghost" className="h-8" onClick={async () => setDiff({ v, d: (await get(`/quote-versions/${v.id}/diff`)).data })}>Diff vs v{v.versionNo - 1}</Button>}
        {role === 'engineer' && !readOnly && !locked && <>
          {!v.isFinal && <Button variant="ghost" className="h-8" loading={busy === 'final' + v.id} onClick={() => act('final' + v.id, () => post(`/quote-versions/${v.id}/mark-final`), 'Marked final')}>Mark final</Button>}
          {v.approvalStatus !== 'approved' && v.approvalStatus !== 'pending' && <Button variant="ghost" className="h-8" loading={busy === 'req' + v.id} onClick={() => act('req' + v.id, () => post(`/quote-versions/${v.id}/request-approval`), 'Approval requested')}>Request approval</Button>}
          <RuleButton className="h-8" blocked={v.approvalRequired && v.approvalStatus !== 'approved' ? 'Needs admin approval before sending' : null} loading={busy === 'send' + v.id} onClick={() => act('send' + v.id, () => post(`/quote-versions/${v.id}/send`), 'Sent to client (email, SMS, WhatsApp)')}><Send className="h-4 w-4" />{v.sentToClientAt ? 'Re-send' : 'Send'}</RuleButton>
          {v.sentToClientAt && !v.clientAcceptedAt && <Button variant="ghost" className="h-8" loading={busy === 'acc' + v.id} onClick={() => act('acc' + v.id, () => post(`/quote-versions/${v.id}/mark-accepted`), 'Marked accepted')}>Mark accepted</Button>}
        </>}
      </div>
    </Glass>)}
    <QuoteBuilder leadId={lead.id} open={open} onClose={() => setOpen(false)} onCreated={refresh} initial={base} nextVersion={nextVersion} />
    <Dialog open={!!diff} onClose={() => setDiff(null)} title={`Changes in v${diff?.v?.versionNo}`}>{diff && (Object.keys(diff.d).length === 0 ? <p className="text-mute">No differences</p> : <div className="space-y-2 text-[13px]">{Object.entries(diff.d).map(([k, c]: any) => <div key={k} className="glass-soft p-2"><div className="font-medium">{k}</div><div className="text-red-700 line-through">{JSON.stringify(c.from)}</div><div className="text-emerald-700">{JSON.stringify(c.to)}</div></div>)}</div>)}</Dialog>
  </div>;
}
