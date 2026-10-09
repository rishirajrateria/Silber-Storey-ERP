'use client';
import { ReceiptPage } from '@/components/public';
export default function Page({ params }: { params: { token: string } }) { return <ReceiptPage token={params.token} />; }
