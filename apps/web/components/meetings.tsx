'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Mic, Square, MapPin, Navigation, CheckCircle2, Circle, Video } from 'lucide-react';
import { get, post, patch } from '@/lib/api';
import { useDirectory, useMe } from '@/lib/hooks';
import { dt, toLocalInput, fromLocalInput } from '@/lib/format';
import { toast, errToast } from '@/lib/store';
import { chunkClear, chunkList, chunkPut, queueOrSend } from '@/lib/offline';
import { Button, Chip, Dialog, Empty, Glass, Input, RuleButton, Select, Spinner, Toggle, cn } from './ui';
import { NotesPanel } from './leads';

const statusColor = (s: string) => (s === 'completed' ? 'green' : s === 'cancelled' || s === 'no_show' ? 'red' : s === 'in_progress' ? 'amber' : 'blue') as any;

/* ---------- MeetingScheduler (6.3) ---------- */
export function MeetingScheduler({ lead, open, onClose, onChanged }: { lead: any; open: boolean; onClose: () => void; onChanged: () => void }) {
  const dir = useDirectory();
  const inHandover = !!lead.pushedToDesignAt && !lead.handoverCompletedAt;
  const [f, setF] = useState({ kind: 'client', type: 'meet', startAt: toLocalInput(new Date(Date.now() + 86400000)), endAt: toLocalInput(new Date(Date.now() + 86400000 + 3600000)), adminInvited: false });
  const [busy, setBusy] = useState(false);
  const designIds = [lead.handover?.designHeadUserId, lead.handover?.juniorUserId].filter(Boolean) as string[];
  const fb = useQuery({ queryKey: ['freebusy', designIds.join(','), f.startAt], enabled: inHandover && designIds.length > 0 && f.kind !== 'client', queryFn: async () => { const day = new Date(f.startAt); const from = new Date(day); from.setHours(0, 0, 0, 0); const to = new Date(day); to.setHours(23, 59, 59, 0); const out: any[] = []; for (const id of designIds) { const r = await get(`/calendar/user/${id}?from=${from.toISOString()}&to=${to.toISOString()}`).catch(() => null); if (r) out.push({ id, busy: r.data.busy }); } return out; } });
  const submit = async () => { setBusy(true); try { await post('/meetings', { leadId: lead.id, kind: f.kind, type: f.type, startAt: fromLocalInput(f.startAt), endAt: fromLocalInput(f.endAt), adminInvited: f.adminInvited }); toast('Meeting scheduled · invite + consent sent'); onChanged(); onClose(); } catch (e) { errToast(e); } finally { setBusy(false); } };
  const siteBlocked = f.type === 'site' && (lead.client?.addressLat == null) ? 'Site meeting needs an exact address (Overview tab)' : null;
  return <Dialog open={open} onClose={onClose} title="Schedule meeting"><div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <Select label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="client">Client meeting</option>{inHandover && <><option value="internal">Internal (handover)</option><option value="second_client">Second client meeting</option></>}</Select>
      <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="meet">Google Meet</option><option value="office">Office</option><option value="site">Site visit</option></Select>
      <Input type="datetime-local" label="Start" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} /><Input type="datetime-local" label="End" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} />
    </div>
    <Toggle checked={f.adminInvited} onChange={(v) => setF({ ...f, adminInvited: v })} label="Invite admin (email + approval)" />
    {fb.data && <div className="glass-soft p-3 text-[12.5px]"><div className="mb-1 font-medium">Design team availability (that day)</div>{fb.data.map((x) => <div key={x.id}>{dir.data?.find((u) => u.id === x.id)?.name}: {x.busy.length ? x.busy.map((b: any) => `${new Date(b.start).toLocaleTimeString([], { timeStyle: 'short' })}–${new Date(b.end).toLocaleTimeString([], { timeStyle: 'short' })}`).join(', ') : 'free'}</div>)}</div>}
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><RuleButton blocked={siteBlocked} loading={busy} onClick={submit}>Schedule</RuleButton></div>
  </div></Dialog>;
}

/* ---------- Meeting list for a lead ---------- */
export function MeetingList({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const me = useMe()!; const role = me.user.role;
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['meetings', lead.id], queryFn: () => get(`/meetings?leadId=${lead.id}`).then((r) => r.data as any[]) });
  const refresh = () => { q.refetch(); onChanged(); };
  return <div>
    {role === 'engineer' && !lead.handoverCompletedAt && <div className="mb-3 flex justify-end"><Button onClick={() => setOpen(true)}>Schedule meeting</Button></div>}
    {q.isLoading ? <Spinner /> : !q.data?.length ? <Glass><Empty text="No meetings yet" /></Glass> : <div className="space-y-2">{q.data.map((m) => <Glass key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><div className="flex items-center gap-2 text-[14px] font-medium">{m.kind.replace('_', ' ')} · {m.type}<Chip color={statusColor(m.status)}>{m.status.replace('_', ' ')}</Chip></div><div className="text-[12.5px] text-mute">{dt(m.startAt)} → {new Date(m.endAt).toLocaleTimeString([], { timeStyle: 'short' })}</div>
        <div className="mt-1 flex gap-3 text-[12px]"><span className={m.inviteAcceptedAt ? 'text-emerald-700' : 'text-mute'}>invite {m.inviteAcceptedAt ? '✓' : '…'}</span><span className={m.consentAcceptedAt ? 'text-emerald-700' : 'text-mute'}>consent {m.consentAcceptedAt ? '✓' : '…'}</span>{m.recordings?.some((r: any) => r.status === 'ready') && <span className="text-emerald-700">recording ✓</span>}{m.mom && <span className="text-emerald-700">MoM ✓</span>}</div></div>
      <div className="flex gap-2">{role === 'engineer' && <Link href={`/engineer/meetings/${m.id}`} className="btn-primary">Open room</Link>}{(role === 'design_head' || role === 'junior_designer' || role === 'admin') && m.mom && <Link href={`/design/leads/${lead.id}?tab=meetings&mom=${m.id}`} className="btn-ghost">Minutes</Link>}</div>
    </Glass>)}</div>}
    <MeetingScheduler lead={lead} open={open} onClose={() => setOpen(false)} onChanged={refresh} />
  </div>;
}

/* ---------- Recorder: MediaRecorder → IndexedDB chunks → upload ---------- */
function useRecorder(meetingId: string) {
  const [recording, setRecording] = useState(false); const [seconds, setSeconds] = useState(0); const [uploading, setUploading] = useState(false);
  const mr = useRef<MediaRecorder | null>(null); const idx = useRef(0); const timer = useRef<any>(null);
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined });
    idx.current = 0; await chunkClear(`rec:${meetingId}:`);
    rec.ondataavailable = async (e) => { if (e.data.size > 0) { await chunkPut(`rec:${meetingId}:${String(idx.current++).padStart(6, '0')}`, e.data); } };
    rec.start(5000); mr.current = rec; setRecording(true); setSeconds(0); timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };
  const stopAndUpload = async () => {
    const rec = mr.current; if (!rec) return;
    await new Promise<void>((res) => { rec.onstop = () => res(); rec.stop(); }); rec.stream.getTracks().forEach((t) => t.stop()); clearInterval(timer.current); setRecording(false);
    await new Promise((r) => setTimeout(r, 300));
    setUploading(true);
    try {
      const chunks = await chunkList(`rec:${meetingId}:`);
      const init = await post(`/meetings/${meetingId}/recording/init`); const uploadId = init.data.uploadId;
      for (let i = 0; i < chunks.length; i++) { const res = await fetch(`/api/v1/meetings/${meetingId}/recording/chunk/${i}?uploadId=${uploadId}`, { method: 'PUT', body: chunks[i].blob, credentials: 'include', headers: { 'content-type': 'application/octet-stream' } }); if (!res.ok) throw new Error(`Chunk ${i} failed`); }
      await post(`/meetings/${meetingId}/recording/complete`, { uploadId, chunks: chunks.length });
      await chunkClear(`rec:${meetingId}:`); toast('Recording uploaded');
    } catch (e) { errToast(e); toast('Chunks kept locally — retry upload when online', 'err'); } finally { setUploading(false); }
  };
  return { recording, seconds, uploading, start, stopAndUpload };
}

/* ---------- MeetingRoom (6.2 /engineer/meetings/[id]) ---------- */
export function MeetingRoom({ id }: { id: string }) {
  const me = useMe()!;
  const q = useQuery({ queryKey: ['meeting', id], queryFn: () => get(`/meetings/${id}`).then((r) => r.data), refetchInterval: 15000 });
  const rec = useRecorder(id);
  const [busy, setBusy] = useState(''); const [resched, setResched] = useState(false); const [rs, setRs] = useState({ startAt: '', endAt: '' });
  const m = q.data;
  const act = async (name: string, fn: () => Promise<any>) => { setBusy(name); try { await fn(); q.refetch(); } catch (e) { errToast(e); } finally { setBusy(''); } };
  const gps = () => new Promise<{ lat: number; lng: number }>((res, rej) => navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), (e) => rej(new Error(e.message)), { enableHighAccuracy: true, timeout: 15000 }));
  useEffect(() => { if (!m || m.type !== 'site' || !m.travelStartedAt || m.status === 'completed' || !me.locationConsentAt) return; const t = setInterval(async () => { try { const p = await gps(); await post('/me/location', { ...p, meetingId: id }); } catch {} }, 60000); return () => clearInterval(t); }, [m, id, me.locationConsentAt]);
  if (q.isLoading || !m) return <Spinner />;
  const ready = m.recordings?.some((r: any) => r.status === 'ready' && r.bytes > 0);
  const active = ['scheduled', 'rescheduled', 'in_progress'].includes(m.status);
  const startBlocked = !m.inviteAcceptedAt ? 'Client has not accepted the invite' : !m.consentAcceptedAt ? 'Recording consent pending' : m.type === 'site' && !m.checkinAt ? 'Check in at the site first' : null;
  const Step = ({ ok, label }: { ok: boolean; label: string }) => <div className={cn('flex items-center gap-2 text-[13.5px]', ok ? 'text-emerald-700' : 'text-mute')}>{ok ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}{label}</div>;
  return <div className="mx-auto max-w-3xl space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-[20px] font-semibold tracking-tight">{m.kind.replace('_', ' ')} meeting · {m.lead.client.name ?? m.lead.client.phone}</h1><div className="text-[13px] text-mute">{dt(m.startAt)} · {m.type}</div></div><Chip color={statusColor(m.status)}>{m.status.replace('_', ' ')}</Chip></div>
    <div className="grid gap-4 md:grid-cols-2">
      <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Pre-start checklist</div><div className="space-y-2"><Step ok={!!m.inviteAcceptedAt} label="Client accepted invite" /><Step ok={!!m.consentAcceptedAt} label="Recording consent accepted" />{m.type === 'site' && <Step ok={!!m.checkinAt} label={`Checked in${m.checkinDistanceM != null ? ` (${Math.round(m.checkinDistanceM)} m)` : ''}`} />}{m.adminInvited && <Step ok={m.adminResponse === 'accepted'} label={`Admin ${m.adminResponse === 'none' ? 'invite pending' : m.adminResponse}${m.adminRemark ? ` · ${m.adminRemark}` : ''}`} />}</div>
        {m.type === 'site' && active && <div className="mt-4 flex flex-wrap gap-2">
          {!m.travelStartedAt ? <Button variant="ghost" loading={busy === 'travel'} onClick={() => act('travel', () => post(`/meetings/${id}/travel-start`))}><Navigation className="h-4 w-4" />Start travel</Button>
            : !m.checkinAt && <Button loading={busy === 'checkin'} onClick={() => act('checkin', async () => { const p = await gps(); const r: any = await queueOrSend('check-in', 'POST', `/meetings/${id}/checkin`, p); if (r?.queued) toast('Check-in queued (offline)'); else toast('Checked in'); })}><MapPin className="h-4 w-4" />Check in (GPS)</Button>}
          {m.lead.client.addressLat && <a className="btn-ghost" target="_blank" href={`https://www.google.com/maps/dir/?api=1&destination=${m.lead.client.addressLat},${m.lead.client.addressLng}`}>Directions</a>}
        </div>}
      </Glass>
      <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Session</div>
        <div className="flex flex-wrap gap-2">
          {m.meetLink && <a className="btn-ghost" href={m.meetLink} target="_blank" rel="noreferrer"><Video className="h-4 w-4" />Open Meet <ExternalLink className="h-3 w-3" /></a>}
          {m.status !== 'in_progress' && active && <RuleButton blocked={startBlocked} loading={busy === 'start'} onClick={() => act('start', () => post(`/meetings/${id}/start`))}>Start meeting</RuleButton>}
        </div>
        {m.status === 'in_progress' && <div className="mt-4 rounded-xl border border-white/80 bg-white/60 p-3">
          <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-[13.5px]"><Mic className={cn('h-4 w-4', rec.recording && 'animate-pulse text-red-600')} />{rec.recording ? 'Recording' : 'Recorder'}</div><div className="font-mono text-[18px]">{String(Math.floor(rec.seconds / 60)).padStart(2, '0')}:{String(rec.seconds % 60).padStart(2, '0')}</div></div>
          <div className="mt-2 flex gap-2">{!rec.recording ? <Button variant="ghost" onClick={rec.start} disabled={rec.uploading}><Mic className="h-4 w-4" />Record</Button> : <Button variant="danger" onClick={rec.stopAndUpload}><Square className="h-4 w-4" />Stop & upload</Button>}{rec.uploading && <span className="text-[12.5px] text-mute">Uploading chunks…</span>}</div>
          <div className="mt-2 text-[12px] text-mute">{ready ? 'A recording is ready.' : 'Mic recording is saved locally in 5 s chunks and uploaded on stop. Online Meet is also recorded by the bot.'}</div>
        </div>}
        {active && <div className="mt-4 flex flex-wrap gap-2 border-t border-white/70 pt-3">
          <RuleButton blocked={!ready ? 'Complete requires a ready recording (mic or bot)' : m.status !== 'in_progress' ? 'Start the meeting first' : null} loading={busy === 'complete'} onClick={() => act('complete', async () => { await post(`/meetings/${id}/complete`); toast('Completed · AI minutes in progress'); })}>Complete</RuleButton>
          <Button variant="ghost" loading={busy === 'noshow'} onClick={() => act('noshow', () => post(`/meetings/${id}/no-show`))}>No-show</Button>
          <Button variant="ghost" onClick={() => { setRs({ startAt: toLocalInput(new Date(m.startAt)), endAt: toLocalInput(new Date(m.endAt)) }); setResched(true); }}>Reschedule</Button>
          <Button variant="ghost" className="text-red-700" loading={busy === 'cancel'} onClick={() => act('cancel', () => post(`/meetings/${id}/cancel`))}>Cancel</Button>
        </div>}
      </Glass>
    </div>
    {m.status === 'completed' && <MeetingOutputs meetingId={id} m={m} />}
    <Dialog open={resched} onClose={() => setResched(false)} title="Reschedule"><div className="grid grid-cols-2 gap-3"><Input type="datetime-local" label="Start" value={rs.startAt} onChange={(e) => setRs({ ...rs, startAt: e.target.value })} /><Input type="datetime-local" label="End" value={rs.endAt} onChange={(e) => setRs({ ...rs, endAt: e.target.value })} /></div><p className="mt-2 text-[12.5px] text-mute">Old invite/consent links are invalidated and new ones are sent.</p><div className="mt-3 flex justify-end"><Button loading={busy === 'resched'} onClick={() => act('resched', async () => { await patch(`/meetings/${id}/reschedule`, { startAt: fromLocalInput(rs.startAt), endAt: fromLocalInput(rs.endAt) }); setResched(false); })}>Save</Button></div></Dialog>
  </div>;
}

export function MeetingOutputs({ meetingId, m }: { meetingId: string; m: any }) {
  const t = useQuery({ queryKey: ['transcript', meetingId], queryFn: () => get(`/meetings/${meetingId}/transcript`).then((r) => r.data).catch(() => null) });
  const mom = useQuery({ queryKey: ['mom', meetingId], queryFn: () => get(`/meetings/${meetingId}/mom`).then((r) => r.data).catch(() => null) });
  const [showT, setShowT] = useState(false);
  return <div className="space-y-4">
    <Glass><div className="mb-2 flex items-center justify-between"><div className="text-[12px] font-medium uppercase tracking-wide text-mute">Minutes of meeting</div>{mom.data?.emailedToClientAt && <Chip color="green">emailed to client</Chip>}</div>
      {mom.data ? <pre className="whitespace-pre-wrap font-sans text-[13.5px]">{mom.data.text}</pre> : <div className="text-[13px] text-mute">Generating… (AI pipeline)</div>}
      {mom.data?.objections?.length > 0 && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px]"><div className="font-medium text-red-800">Client objections</div>{mom.data.objections.map((o: any) => <div key={o.id}>• {o.remark} <span className="text-mute">({dt(o.at)})</span></div>)}</div>}
    </Glass>
    <Glass><button className="text-[12px] font-medium uppercase tracking-wide text-mute" onClick={() => setShowT(!showT)}>Transcript {showT ? '▾' : '▸'}</button>{showT && <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-ink/80">{t.data?.text ?? 'Not ready'}</pre>}
      <div className="mt-2 text-[12px] text-mute">Duration {m.durationSec ? Math.round(m.durationSec / 60) + ' min' : '—'} · {m.recordings?.length ?? 0} recording(s)</div></Glass>
    <NotesInline leadId={m.leadId} meetingId={meetingId} />
  </div>;
}
function NotesInline({ leadId, meetingId }: { leadId: string; meetingId: string }) { return <NotesPanel leadId={leadId} meetingId={meetingId} />; }
