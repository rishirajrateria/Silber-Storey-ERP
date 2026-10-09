'use client';
import { DashboardAdmin } from '@/components/admin';
export default function Page({ params }: { params: { dashboard: string } }) { return <DashboardAdmin dashboard={params.dashboard} />; }
