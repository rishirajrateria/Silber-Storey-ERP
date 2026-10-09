'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { ago } from '@/lib/format';
import { PageHeader, Spinner, StageBadge, Table, Chip } from '@/components/ui';
export default function Page() {
  const q = useQuery({ queryKey: ['design', 'leads'], queryFn: () => get('/design/leads').then((r) => r.data as any[]) });
  return <div><PageHeader title="Projects" sub="Handovers assigned to you" />
    {q.isLoading ? <Spinner /> : <Table head={['Client', 'Stage', 'Junior', 'Handover', 'Pushed']} rows={(q.data ?? []).map((l) => [<Link key="n" href={`/design/leads/${l.id}`} className="font-medium text-accent hover:underline">{l.client?.name ?? 'Client'}</Link>, <StageBadge key="s" stage={l.stage} />, l.handover?.juniorUserId ? 'assigned' : <Chip key="j" color="amber">unassigned</Chip>, l.handover?.completedAt ? <Chip key="h" color="green">complete</Chip> : <Chip key="h" color="blue">in progress</Chip>, ago(l.pushedToDesignAt)])} empty="No projects yet" />}
  </div>;
}
