'use client';
import { LeadDetail } from '@/components/lead-detail';
export default function Page({ params }: { params: { id: string } }) { return <LeadDetail id={params.id} />; }
