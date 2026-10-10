'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useDirectory, useMe, userName } from '@/lib/hooks';
import { dt } from '@/lib/format';
import { toast, errToast } from '@/lib/store';
import { Button, Chip, Empty, Glass, RuleButton, Select, Spinner, cn } from './ui';

/* ---------- HandoverPanel: push, assign junior, 3 acceptances (9.12–9.14) ---------- */
export function HandoverPanel({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const me = useMe()!; const role = me.user.role; const dir = useDirectory();
  const q = useQuery({ queryKey: ['handover', lead.id], queryFn: () => get(`/handovers/${lead.id}`).then((r) => r.data) });
  const [headId, setHeadId] = useState(''); const [jrId, setJrId] = useState(''); const [busy, setBusy] = useState('');
  const refresh = () => { q.refetch(); onChanged(); };
  const act = async (k: string, fn: () => Promise<any>, msg?: string) => { setBusy(k); try { await fn(); if (msg) toast(msg); refresh(); } catch (e) { errToast(e); } finally { setBusy(''); } };
  if (q.isLoading) return <Spinner />;
  const h = q.data;
  const heads = (dir.data ?? []).filter((u) => u.role === 'design_head'); const juniors = (dir.data ?? []).filter((u) => u.role === 'junior_designer');
  const advancePaid = ['advance_paid', 'pushed_to_design', 'internal_meeting_done', 'second_client_meeting_done', 'handover_accepted'].includes(lead.stage);
  if (!h) {
    if (role !== 'engineer') return <Glass><Empty text="Not pushed to design yet" /></Glass>;
    return <Glass className="max-w-md"><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Push to design</div>
      <Select label="Design head" value={headId} onChange={(e) => setHeadId(e.target.value)}><option value="">Select…</option>{heads.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
      <div className="mt-3"><RuleButton blocked={!advancePaid ? 'Push to design requires the advance (milestone 1) to be paid' : !headId ? 'Pick a design head' : null} loading={busy === 'push'} onClick={() => act('push', () => post(`/leads/${lead.id}/push-to-design`, { designHeadUserId: headId }), 'Pushed to design')}>Push to design</RuleButton></div></Glass>;
  }
  const Row = ({ label, at, who }: { label: string; at: string | null; who: string | null }) => <div className={cn('flex items-center justify-between py-2 text-[13.5px]', at ? 'text-emerald-300' : 'text-mute')}><span className="flex items-center gap-2">{at ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}{label} · {userName(dir.data, who)}</span><span className="text-[12px] text-mute">{at ? dt(at) : 'pending'}</span></div>;
  const mine = role === 'engineer' ? h.acceptedByEngineerAt : role === 'design_head' ? h.acceptedByHeadAt : role === 'junior_designer' ? h.acceptedByJuniorAt : 'n/a';
  const canAccept = (role === 'engineer' && lead.engineerUserId === me.user.id) || (role === 'design_head' && h.designHeadUserId === me.user.id) || (role === 'junior_designer' && h.juniorUserId === me.user.id);
  return <div className="grid gap-4 md:grid-cols-2">
    <Glass><div className="mb-2 flex items-center justify-between"><div className="text-[12px] font-medium uppercase tracking-wide text-mute">Acceptances</div>{h.completedAt ? <Chip color="green">complete</Chip> : <Chip color="amber">in progress</Chip>}</div>
      <div className="divide-y divide-white/10"><Row label="Engineer" at={h.acceptedByEngineerAt} who={lead.engineerUserId} /><Row label="Design head" at={h.acceptedByHeadAt} who={h.designHeadUserId} /><Row label="Junior designer" at={h.acceptedByJuniorAt} who={h.juniorUserId} /></div>
      {canAccept && !mine && <div className="mt-3"><RuleButton blocked={role === 'junior_designer' && !h.juniorUserId ? 'Not assigned yet' : null} loading={busy === 'acc'} onClick={() => act('acc', () => post(`/handovers/${lead.id}/accept`), 'Accepted')}>Accept handover</RuleButton></div>}
      {h.completedAt && <div className="mt-2 text-[12.5px] text-mute">Completed {dt(h.completedAt)}</div>}
    </Glass>
    <Glass><div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Team</div>
      <div className="text-[13.5px]">Design head: <b>{userName(dir.data, h.designHeadUserId)}</b></div>
      <div className="text-[13.5px]">Junior: <b>{h.juniorUserId ? userName(dir.data, h.juniorUserId) : 'not assigned'}</b></div>
      {role === 'design_head' && h.designHeadUserId === me.user.id && !h.completedAt && <div className="mt-3 flex gap-2"><Select value={jrId} onChange={(e) => setJrId(e.target.value)}><option value="">Select junior…</option>{juniors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select><Button loading={busy === 'jr'} disabled={!jrId} onClick={() => act('jr', () => post(`/handovers/${lead.id}/assign-junior`, { juniorUserId: jrId }), 'Junior assigned · files, MoMs and meetings follow')}>{h.juniorUserId ? 'Reassign' : 'Assign'}</Button></div>}
      <div className="mt-3 text-[12.5px] text-mute">Internal meeting {h.internalMeetingId ? '✓ scheduled' : 'not scheduled'} · Second client meeting {h.secondMeetingId ? '✓ scheduled' : 'not scheduled'}</div>
    </Glass>
  </div>;
}
