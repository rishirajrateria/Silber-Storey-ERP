'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Send, IndianRupee } from 'lucide-react';
import { get, post, patch, fileUrl } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { inr, dt, dd, toLocalInput, fromLocalInput } from '@/lib/format';
import { toast, errToast } from '@/lib/store';
import { Button, Chip, Dialog, Empty, Glass, Input, RuleButton, Select, Spinner, Textarea } from './ui';

const mColor = (s: string) => (s === 'paid' ? 'green' : s === 'invoiced' ? 'blue' : 'gray') as any;
const iColor = (s: string) => (s === 'paid' ? 'green' : s === 'partially_paid' ? 'amber' : s === 'sent' ? 'blue' : s === 'cancelled' ? 'red' : 'gray') as any;

/* ---------- PipelineTable + milestone edits (9.9) ---------- */
export function PipelinePanel({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const me = useMe()!; const fin = me.user.role === 'finance';
  const q = useQuery({ queryKey: ['pipeline', lead.id], queryFn: () => get(`/leads/${lead.id}/pipeline`).then((r) => r.data) });
  const [pct, setPct] = useState<any>(null); const [pushBack, setPushBack] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState('');
  const refresh = () => { q.refetch(); onChanged(); };
  const act = async (k: string, fn: () => Promise<any>, msg?: string) => { setBusy(k); try { await fn(); if (msg) toast(msg); refresh(); } catch (e) { errToast(e); } finally { setBusy(''); } };
  if (q.isLoading) return <Spinner />;
  const p = q.data;
  if (!p) return <Glass><Empty text="No payment pipeline (lead not pushed to finance yet)" /></Glass>;
  const total = p.milestones.reduce((a: number, m: any) => a + m.amount, 0);
  const invoiced = p.milestones.some((m: any) => m.status !== 'pending');
  return <div className="space-y-3">
    <Glass className="p-0"><table className="w-full text-[13.5px]"><thead className="border-b border-white/10"><tr><th className="th">#</th><th className="th">Milestone</th><th className="th">%</th><th className="th">Amount</th><th className="th">Due</th><th className="th">Status</th><th className="th"></th></tr></thead><tbody>
      {p.milestones.map((m: any) => <tr key={m.id} className="border-b border-white/50 last:border-0"><td className="td">{m.order}</td><td className="td font-medium">{m.name}</td><td className="td">{m.pct}%</td><td className="td">{inr(m.amount)}</td>
        <td className="td">{fin && m.status === 'pending' ? <input type="date" className="field h-8 w-36" defaultValue={m.dueDate?.slice(0, 10) ?? ''} onBlur={(e) => e.target.value !== (m.dueDate?.slice(0, 10) ?? '') && act('due' + m.id, () => patch(`/milestones/${m.id}`, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : null }))} /> : dd(m.dueDate)}</td>
        <td className="td"><Chip color={mColor(m.status)}>{m.status}</Chip></td>
        <td className="td"><div className="flex justify-end gap-1">{fin && m.status === 'pending' && <><Button variant="ghost" className="h-8" onClick={() => setPct({ m, newPct: m.pct, reason: '' })}>Change %</Button><Button className="h-8" loading={busy === 'inv' + m.id} onClick={() => act('inv' + m.id, () => post(`/milestones/${m.id}/invoice`), 'Draft invoice created')}>Invoice</Button></>}</div></td></tr>)}
      <tr><td className="td" colSpan={3}><b>Total</b></td><td className="td"><b>{inr(total)}</b></td><td colSpan={3} /></tr></tbody></table></Glass>
    {fin && !invoiced && <div className="flex justify-end"><Button variant="ghost" onClick={() => setPushBack(true)}>Push back to engineer</Button></div>}
    <Dialog open={!!pct} onClose={() => setPct(null)} title="Request milestone % change">{pct && <div className="space-y-3"><p className="text-[13px] text-mute">Applied only after admin approval. The delta is rebalanced across later pending milestones.</p><Input type="number" label={`New % (current ${pct.m.pct}%)`} value={pct.newPct} onChange={(e) => setPct({ ...pct, newPct: Number(e.target.value) })} /><Textarea label="Reason *" value={pct.reason} onChange={(e) => setPct({ ...pct, reason: e.target.value })} /><div className="flex justify-end"><RuleButton blocked={!pct.reason.trim() ? 'Reason required' : null} loading={busy === 'pct'} onClick={() => act('pct', async () => { await post(`/milestones/${pct.m.id}/request-pct-change`, { newPct: pct.newPct, reason: pct.reason }); setPct(null); }, 'Approval requested')}>Request</RuleButton></div></div>}</Dialog>
    <Dialog open={pushBack} onClose={() => setPushBack(false)} title="Push back to engineer"><Textarea label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} /><div className="mt-3 flex justify-end"><RuleButton blocked={!reason.trim() ? 'Reason required' : null} loading={busy === 'pb'} onClick={() => act('pb', async () => { await post(`/leads/${lead.id}/push-back-to-engineer`, { reason }); setPushBack(false); }, 'Pushed back')}>Push back</RuleButton></div></Dialog>
  </div>;
}

/* ---------- Invoices + PaymentDialog (9.10) ---------- */
export function InvoicesPanel({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const me = useMe()!; const fin = me.user.role === 'finance';
  const q = useQuery({ queryKey: ['pipeline', lead.id], queryFn: () => get(`/leads/${lead.id}/pipeline`).then((r) => r.data) });
  const [pay, setPay] = useState<any>(null); const [cn, setCn] = useState<any>(null); const [busy, setBusy] = useState('');
  const refresh = () => { q.refetch(); onChanged(); };
  const act = async (k: string, fn: () => Promise<any>, msg?: string) => { setBusy(k); try { await fn(); if (msg) toast(msg); refresh(); } catch (e) { errToast(e); } finally { setBusy(''); } };
  if (q.isLoading) return <Spinner />;
  const invoices = (q.data?.milestones ?? []).filter((m: any) => m.invoice).map((m: any) => ({ ...m.invoice, milestone: m }));
  if (!invoices.length) return <Glass><Empty text="No invoices yet — create one from the Pipeline tab" /></Glass>;
  return <div className="space-y-3">{invoices.map((inv: any) => { const paid = inv.payments.reduce((a: number, p: any) => a + p.amount, 0); return <Glass key={inv.id} className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="flex items-center gap-2 text-[15px] font-semibold">{inv.fullNumber ?? 'Draft invoice'}<Chip color={iColor(inv.status)}>{inv.status.replace('_', ' ')}</Chip></div><div className="text-[12.5px] text-mute">{inv.milestone.name} · {inv.issueDate ? dd(inv.issueDate) : 'not issued'} · {inv.igst ? `IGST ${inv.gstPct}%` : `CGST+SGST ${inv.gstPct}%`}</div></div>
      <div className="text-right"><div className="text-[16px] font-semibold">{inr(inv.total)}</div><div className="text-[12px] text-mute">paid {inr(paid)} · due {inr(inv.total - paid)}</div></div></div>
    {inv.payments.length > 0 && <div className="mt-2 divide-y divide-white/10 text-[13px]">{inv.payments.map((p: any) => <div key={p.id} className="flex items-center justify-between py-1.5"><span>{inr(p.amount)} · {p.mode}{p.reference ? ` · ${p.reference}` : ''} · {dd(p.paidOn)}</span>{p.receipt && <a className="text-white hover:underline" href={fileUrl(`/receipts/${p.receipt.id}/pdf`)} target="_blank" rel="noreferrer">Receipt {p.receipt.fullNumber}</a>}</div>)}</div>}
    <div className="mt-3 flex flex-wrap gap-2">
      {inv.status !== 'draft' && <a className="btn-ghost h-8" href={fileUrl(`/invoices/${inv.id}/pdf`)} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" />PDF</a>}
      {fin && inv.status === 'draft' && <Button className="h-8" loading={busy === 'send' + inv.id} onClick={() => act('send' + inv.id, () => post(`/invoices/${inv.id}/send`), 'Invoice numbered & sent (email, SMS, WhatsApp)')}><Send className="h-4 w-4" />Send</Button>}
      {fin && ['sent', 'partially_paid'].includes(inv.status) && <Button className="h-8" onClick={() => setPay({ inv, amount: inv.total - paid, mode: 'upi', reference: '', paidOn: toLocalInput(new Date()) })}><IndianRupee className="h-4 w-4" />Record payment</Button>}
      {fin && inv.status !== 'draft' && <Button variant="ghost" className="h-8" onClick={() => setCn({ inv, amount: 0, reason: '' })}>Credit note</Button>}
      {fin && ['sent'].includes(inv.status) && inv.payments.length === 0 && <Button variant="ghost" className="h-8 text-red-300" onClick={() => setCn({ inv, amount: -1, reason: '', cancel: true })}>Request cancellation</Button>}
    </div>
  </Glass>; })}
    <Dialog open={!!pay} onClose={() => setPay(null)} title={`Record payment · ${pay?.inv.fullNumber}`}>{pay && <div className="space-y-3"><Input type="number" label="Amount" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} /><Select label="Mode" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{['upi', 'neft', 'cheque', 'cash', 'other'].map((m) => <option key={m}>{m}</option>)}</Select><Input label="Reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /><Input type="datetime-local" label="Paid on" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} /><p className="text-[12.5px] text-mute">A receipt is generated and sent with a thank-you on all channels; engineer and admin are emailed.</p><div className="flex justify-end"><Button loading={busy === 'pay'} disabled={pay.amount <= 0} onClick={() => act('pay', async () => { await post(`/invoices/${pay.inv.id}/payments`, { amount: pay.amount, mode: pay.mode, reference: pay.reference || undefined, paidOn: fromLocalInput(pay.paidOn) }); setPay(null); }, 'Payment recorded · receipt sent')}>Save payment</Button></div></div>}</Dialog>
    <Dialog open={!!cn} onClose={() => setCn(null)} title={cn?.cancel ? 'Request invoice cancellation' : 'Request credit note'}>{cn && <div className="space-y-3">{!cn.cancel && <Input type="number" label="Amount" value={cn.amount} onChange={(e) => setCn({ ...cn, amount: Number(e.target.value) })} />}<Textarea label="Reason *" value={cn.reason} onChange={(e) => setCn({ ...cn, reason: e.target.value })} /><p className="text-[12.5px] text-mute">Needs Admin approval. {cn.cancel ? 'On approval the invoice is marked cancelled and the milestone reopens.' : ''}</p><div className="flex justify-end"><RuleButton blocked={!cn.cancel && cn.amount <= 0 ? 'Enter an amount' : !cn.reason.trim() ? 'Reason required' : null} loading={busy === 'cn'} onClick={() => act('cn', async () => { if (cn.cancel) await post(`/invoices/${cn.inv.id}/cancel-request`, { reason: cn.reason }); else await post(`/invoices/${cn.inv.id}/credit-note`, { amount: cn.amount, reason: cn.reason }); setCn(null); }, 'Sent for approval')}>Request</RuleButton></div></div>}</Dialog>
  </div>;
}
