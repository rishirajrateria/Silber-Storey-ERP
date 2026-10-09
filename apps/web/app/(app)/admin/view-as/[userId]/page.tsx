'use client';
import { ViewAs } from '@/components/admin';
export default function Page({ params }: { params: { userId: string } }) { return <ViewAs userId={params.userId} />; }
