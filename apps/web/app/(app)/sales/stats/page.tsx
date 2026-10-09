'use client';
import { StatsCards } from '@/components/shared';
import { PageHeader } from '@/components/ui';
export default function Page() { return <div><PageHeader title="Stats" /><StatsCards dashboard="sales" /></div>; }
