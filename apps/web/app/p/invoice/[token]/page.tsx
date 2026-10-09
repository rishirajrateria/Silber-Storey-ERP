'use client';
import { InvoicePage } from '@/components/public';
export default function Page({ params }: { params: { token: string } }) { return <InvoicePage token={params.token} />; }
