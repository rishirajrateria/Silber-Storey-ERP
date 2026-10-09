'use client';
import { ConsentPage } from '@/components/public';
export default function Page({ params }: { params: { token: string } }) { return <ConsentPage token={params.token} />; }
