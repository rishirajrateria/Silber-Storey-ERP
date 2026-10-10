'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLead, useMe } from '@/lib/hooks';
import { ns } from '@/lib/socket';
import { Glass, Spinner, Tab, Tabs, Empty, KV } from './ui';
import { BillingForm, FilesPanel, LeadHeader, LeadOverview, NotesPanel, Timeline } from './leads';
import { MeetingList, MeetingOutputs } from './meetings';
import { QuotePanel } from './quotes';
import { InvoicesPanel, PipelinePanel } from './finance';
import { HandoverPanel } from './handover';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { dt } from '@/lib/format';

const TABS: Record<string, Array<{ key: string; label: string }>> = {
  sales: [{ key: 'overview', label: 'Overview' }, { key: 'timeline', label: 'Timeline' }],
  engineer: [{ key: 'overview', label: 'Overview' }, { key: 'meetings', label: 'Meetings' }, { key: 'quote', label: 'Quote' }, { key: 'billing', label: 'Billing' }, { key: 'files', label: 'Files' }, { key: 'notes', label: 'Notes' }, { key: 'timeline', label: 'Timeline' }, { key: 'handover', label: 'Handover' }],
  finance: [{ key: 'overview', label: 'Overview' }, { key: 'quote', label: 'Quote' }, { key: 'pipeline', label: 'Pipeline' }, { key: 'invoices', label: 'Invoices' }, { key: 'timeline', label: 'Timeline' }],
  design_head: [{ key: 'package', label: 'Package' }, { key: 'meetings', label: 'Meetings' }, { key: 'notes', label: 'Notes' }, { key: 'handover', label: 'Handover' }],
  junior_designer: [{ key: 'package', label: 'Package' }, { key: 'meetings', label: 'Meetings' }, { key: 'notes', label: 'Notes' }, { key: 'handover', label: 'Handover' }],
  admin: [{ key: 'overview', label: 'Overview' }, { key: 'meetings', label: 'Meetings' }, { key: 'quote', label: 'Quote' }, { key: 'billing', label: 'Billing' }, { key: 'pipeline', label: 'Pipeline' }, { key: 'invoices', label: 'Invoices' }, { key: 'files', label: 'Files' }, { key: 'notes', label: 'Notes' }, { key: 'timeline', label: 'Timeline' }, { key: 'handover', label: 'Handover' }],
};

export function LeadDetail({ id }: { id: string }) {
  const me = useMe()!; const role = me.user.role; const qc = useQueryClient();
  const sp = useSearchParams(); const r = useRouter();
  const tabs = TABS[role]; const tab = sp.get('tab') ?? tabs[0].key;
  const lead = useLead(id);
  const refresh = () => { lead.refetch(); qc.invalidateQueries({ queryKey: ['timeline', id] }); qc.invalidateQueries({ queryKey: ['leads'] }); };
  useEffect(() => { const s = ns(`/lead/${id}`); const h = () => { lead.refetch(); qc.invalidateQueries({ queryKey: ['timeline', id] }); qc.invalidateQueries({ queryKey: ['meetings', id] }); qc.invalidateQueries({ queryKey: ['quote', id] }); qc.invalidateQueries({ queryKey: ['pipeline', id] }); }; s.on('timeline', h); return () => { s.off('timeline', h); s.disconnect(); }; }, [id]); // eslint-disable-line
  if (lead.isLoading) return <Spinner />;
  if (lead.error || !lead.data) return <Glass><Empty text="Lead not found or not accessible" /></Glass>;
  const l = lead.data;
  if (l.headerOnly) return <Glass><div className="flex items-center gap-3"><h1 className="text-[18px] font-semibold">{l.clientName}</h1><span className="chip border-white/15 bg-white/10 text-white">{l.stage.replace(/_/g, ' ')}</span></div><p className="mt-2 text-[13px] text-mute">Handover complete — this lead is now with the design team.</p></Glass>;
  return <div>
    <LeadHeader lead={l} onChanged={refresh} />
    <Tabs value={tab} onChange={(t) => r.replace(`?tab=${t}`)} tabs={tabs}>
      <Tab id="overview"><LeadOverview lead={l} onChanged={refresh} /></Tab>
      <Tab id="package"><DesignPackage leadId={id} /></Tab>
      <Tab id="meetings"><MeetingList lead={l} onChanged={refresh} />{sp.get('mom') && <div className="mt-4"><MeetingOutputs meetingId={sp.get('mom')!} m={{ leadId: id }} /></div>}</Tab>
      <Tab id="quote"><QuotePanel lead={l} onChanged={refresh} readOnly={role !== 'engineer'} /></Tab>
      <Tab id="billing"><BillingForm lead={l} onChanged={refresh} readOnly={role !== 'engineer'} /></Tab>
      <Tab id="pipeline"><PipelinePanel lead={l} onChanged={refresh} /></Tab>
      <Tab id="invoices"><InvoicesPanel lead={l} onChanged={refresh} /></Tab>
      <Tab id="files"><FilesPanel leadId={id} /></Tab>
      <Tab id="notes"><NotesPanel leadId={id} /></Tab>
      <Tab id="timeline"><Timeline leadId={id} /></Tab>
      <Tab id="handover"><HandoverPanel lead={l} onChanged={refresh} /></Tab>
    </Tabs>
  </div>;
}

function DesignPackage({ leadId }: { leadId: string }) {
  const q = useQuery({ queryKey: ['package', leadId], queryFn: () => get(`/design/leads/${leadId}/package`).then((r) => r.data) });
  if (q.isLoading) return <Spinner />;
  const p = q.data; if (!p) return <Glass><Empty text="No package" /></Glass>;
  const final = p.quote?.versions?.[0];
  return <div className="grid gap-4 lg:grid-cols-2">
    <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Client & requirement</div><div className="grid grid-cols-2 gap-3"><KV k="Name" v={p.client?.name} /><KV k="Area" v={p.client?.locationArea} /><KV k="Address" v={p.client?.exactAddress} /><KV k="Budget" v={p.budget} /><div className="col-span-2"><KV k="Requirement" v={p.requirement} /></div></div>{p.aiProfile && <div className="mt-3 whitespace-pre-wrap rounded-xl bg-white/[.06] p-3 text-[13px]">{p.aiProfile}</div>}</Glass>
    <Glass><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Final quote</div>{final ? <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap font-sans text-[12.5px]">{final.text}</pre> : <Empty text="No final quote" />}</Glass>
    <Glass className="lg:col-span-2"><div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-mute">Minutes of meetings</div>{!p.meetings?.some((m: any) => m.mom) ? <Empty text="No minutes yet" /> : p.meetings.filter((m: any) => m.mom).map((m: any) => <details key={m.id} className="mb-2 rounded-xl border border-white/10 bg-white/5 p-3"><summary className="cursor-pointer text-[13.5px] font-medium">{m.kind.replace('_', ' ')} · {dt(m.startAt)}</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-[13px]">{m.mom.text}</pre></details>)}</Glass>
  </div>;
}
