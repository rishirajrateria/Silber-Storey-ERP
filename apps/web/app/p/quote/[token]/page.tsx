'use client';
import { QuotePage } from '@/components/public';
export default function Page({ params }: { params: { token: string } }) { return <QuotePage token={params.token} />; }
