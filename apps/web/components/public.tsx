'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, FileText, MapPin, Video } from 'lucide-react';
import { get, post, fileUrl } from '@/lib/api';
import { dt, inr } from '@/lib/format';
import { Button, Glass, Textarea, cn } from './ui';

function Shell({ title, company, children, state }: { title: string; company?: string; children: React.ReactNode; state: 'loading' | 'error' | 'ok' }) {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-4">
    <div className="mb-4 flex items-center gap-2"><div className="h-9 w-9 rounded-xl bg-accent/90" /><div><div className="text-[15px] font-semibold">{company ?? 'Loading…'}</div><div className="text-[12px] text-mute">{title}</div></div></div>
    <Glass strong>{state === 'loading' ? <div className="py-8 text-center text-mute">Loading…</div> : state === 'error' ? <div className="py-8 text-center text-[14px] text-red-700">This link is invalid or has expired.</div> : children}</Glass>
  </main>;
}
function usePublic(path: string) {
  const [data, setData] = useState<any>(null); const [state, setState] = useState<'loading' | 'error' | 'ok'>('loading');
  const load = () => get(path).then((r) => { setData(r.data); setState('ok'); }).catch(() => setState('error'));
  useEffect(() => { load(); }, [path]); // eslint-disable-line
  return { data, state, reload: load };
}

export function InvitePage({ token }: { token: string }) {
  const { data, state, reload } = usePublic(`/p/invite/${token}`); const [busy, setBusy] = useState(false); const [slots, setSlots] = useState(''); const [resched, setResched] = useState(false);
  const accept = async () => { setBusy(true); try { await post(`/p/invite/${token}/accept`); reload(); } finally { setBusy(false); } };
  const m = data?.meeting;
  return <Shell title="Meeting invitation" company={data?.company} state={state}>{m && <div className="space-y-4 text-[14px]">
    <p>Hi {data.clientName ?? 'there'}, we have scheduled a meeting with you.</p>
    <div className="glass-soft p-3"><div className="font-medium">{dt(m.startAt)}</div><div className="text-mute">{m.type === 'meet' ? 'Online · Google Meet' : m.type === 'office' ? `At our office · ${m.officeAddress ?? ''}` : 'At your site'}</div>{m.meetLink && <a className="mt-2 flex items-center gap-1 text-accent" href={m.meetLink}><Video className="h-4 w-4" />{m.meetLink}</a>}{m.type === 'office' && <a className="mt-2 flex items-center gap-1 text-accent" target="_blank" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.officeAddress ?? '')}`} rel="noreferrer"><MapPin className="h-4 w-4" />Directions</a>}</div>
    {m.inviteAcceptedAt ? <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" />You confirmed this meeting. Thank you!</div> : <Button className="w-full" loading={busy} onClick={accept}>Confirm meeting</Button>}
    <a href={`/p/consent/${data.consentToken}`} className="btn-ghost w-full">Recording consent →</a>
    {!resched ? <button className="w-full text-center text-[13px] text-mute underline" onClick={() => setResched(true)}>Need a different time?</button> : <div className="space-y-2"><Textarea label="Preferred slots" placeholder="e.g. Sat 11am, Sun 4pm" value={slots} onChange={(e) => setSlots(e.target.value)} /><Button variant="ghost" className="w-full" disabled={!slots.trim()} onClick={async () => { await post(`/p/invite/${token}/reschedule`, { preferredSlots: slots.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) }); setResched(false); setSlots(''); alert('Thanks — we will get back to you.'); }}>Send request</Button></div>}
  </div>}</Shell>;
}
export function ConsentPage({ token }: { token: string }) {
  const { data, state, reload } = usePublic(`/p/consent/${token}`); const [busy, setBusy] = useState(false); const [agree, setAgree] = useState(false);
  const accept = async () => { setBusy(true); try { await post(`/p/consent/${token}/accept`); reload(); } finally { setBusy(false); } };
  return <Shell title="Recording consent" company={data?.company} state={state}>{data && <div className="space-y-4 text-[14px]">
    <p>Hi {data.clientName ?? 'there'}. To prepare accurate minutes and a better design brief, we record our consultation on {dt(data.meeting.startAt)} and transcribe it with AI.</p>
    <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink/80"><li>The recording and transcript are used only for your project.</li><li>You receive the minutes by email and can object to anything inaccurate.</li><li>Recordings are retained until your project closes.</li></ul>
    {data.meeting.consentAcceptedAt ? <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" />Consent recorded. Thank you!</div> : <><label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I consent to this meeting being recorded and transcribed.</label><Button className="w-full" disabled={!agree} loading={busy} onClick={accept}>I consent</Button></>}
  </div>}</Shell>;
}
export function MomPage({ token }: { token: string }) {
  const { data, state, reload } = usePublic(`/p/mom/${token}`); const [remark, setRemark] = useState(''); const [busy, setBusy] = useState(false);
  return <Shell title="Minutes of meeting" company={data?.company} state={state}>{data && <div className="space-y-4 text-[14px]">
    <p className="text-mute">Meeting on {dt(data.meetingDate)} with {data.clientName ?? 'you'}</p>
    <pre className="whitespace-pre-wrap rounded-xl bg-white/60 p-3 font-sans text-[13.5px]">{data.text}</pre>
    {data.objections?.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-[13px]"><div className="font-medium">Your objections</div>{data.objections.map((o: any, i: number) => <div key={i}>• {o.remark}</div>)}</div>}
    <Textarea label="Something inaccurate? Raise an objection" value={remark} onChange={(e) => setRemark(e.target.value)} /><Button variant="ghost" className="w-full" disabled={!remark.trim()} loading={busy} onClick={async () => { setBusy(true); try { await post(`/p/mom/${token}/objection`, { remark }); setRemark(''); reload(); } finally { setBusy(false); } }}>Submit objection</Button>
  </div>}</Shell>;
}
export function QuotePage({ token }: { token: string }) {
  const { data, state, reload } = usePublic(`/p/quote/${token}`); const [remark, setRemark] = useState(''); const [busy, setBusy] = useState(''); const [changes, setChanges] = useState(false);
  return <Shell title="Quotation" company={data?.company} state={state}>{data && <div className="space-y-4 text-[14px]">
    <div className="flex items-end justify-between"><div><div className="text-mute">Quote v{data.versionNo}{data.isFinal ? ' · final' : ''}</div><div className="text-[12px] text-mute">Valid {data.validityDays} days from {dt(data.createdAt)}</div></div><div className="text-right"><div className="text-[22px] font-semibold">{inr(data.total)}</div><div className="text-[12px] text-mute">{inr(data.subtotal)} + GST {data.gstPct}%</div></div></div>
    <div className="glass-soft p-3 text-[13px]"><div className="mb-1 font-medium">Payment schedule</div>{(data.paymentSchedule ?? []).map((m: any, i: number) => <div key={i} className="flex justify-between"><span>{m.name} · {m.pct}%</span><span>{inr(m.amount)}</span></div>)}</div>
    {data.hasPdf && <a className="btn-ghost w-full" href={fileUrl(`/p/quote/${token}/pdf`)} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" />View full quotation</a>}
    <details><summary className="cursor-pointer text-[13px] text-mute">Full text</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-[12.5px]">{data.text}</pre></details>
    {data.clientAcceptedAt ? <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" />Accepted on {dt(data.clientAcceptedAt)}. Thank you!</div> : <>
      <Button className="w-full" loading={busy === 'a'} onClick={async () => { setBusy('a'); try { await post(`/p/quote/${token}/accept`); reload(); } finally { setBusy(''); } }}>Accept quotation</Button>
      {!changes ? <button className="w-full text-center text-[13px] text-mute underline" onClick={() => setChanges(true)}>Request changes</button> : <div className="space-y-2"><Textarea placeholder="What would you like changed?" value={remark} onChange={(e) => setRemark(e.target.value)} /><Button variant="ghost" className="w-full" disabled={!remark.trim()} loading={busy === 'c'} onClick={async () => { setBusy('c'); try { await post(`/p/quote/${token}/request-changes`, { remark }); setChanges(false); setRemark(''); reload(); } finally { setBusy(''); } }}>Send request</Button></div>}
      {data.clientChangeRequest && <div className="rounded-xl bg-amber-50 p-3 text-[13px]">Your request: {data.clientChangeRequest}</div>}</>}
  </div>}</Shell>;
}
export function InvoicePage({ token }: { token: string }) {
  const { data, state } = usePublic(`/p/invoice/${token}`);
  return <Shell title="Tax invoice" company={data?.company} state={state}>{data && <div className="space-y-4 text-[14px]">
    <div className="flex items-end justify-between"><div><div className="font-medium">{data.fullNumber}</div><div className="text-[12px] text-mute">{dt(data.issueDate)} · {data.status.replace('_', ' ')}</div></div><div className="text-right"><div className="text-[22px] font-semibold">{inr(data.total)}</div><div className="text-[12px] text-mute">paid {inr(data.paid)}</div></div></div>
    <pre className="whitespace-pre-wrap rounded-xl bg-white/60 p-3 font-sans text-[13px]">{data.text}</pre>
    {data.hasPdf && <a className="btn-primary w-full" href={fileUrl(`/p/invoice/${token}/pdf`)} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" />Download invoice</a>}
  </div>}</Shell>;
}
export function ReceiptPage({ token }: { token: string }) {
  const { data, state } = usePublic(`/p/receipt/${token}`);
  return <Shell title="Payment receipt" company={data?.company} state={state}>{data && <div className="space-y-4 text-[14px]">
    <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" />Thank you, {data.clientName ?? ''}! We received {inr(data.amount)}.</div>
    <div className="glass-soft p-3 text-[13px]"><div>Receipt {data.fullNumber}</div><div>Against invoice {data.invoiceNumber}</div><div>Paid on {dt(data.paidOn)}</div></div>
    {data.hasPdf && <a className="btn-ghost w-full" href={fileUrl(`/p/receipt/${token}/pdf`)} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" />Download receipt</a>}
  </div>}</Shell>;
}
