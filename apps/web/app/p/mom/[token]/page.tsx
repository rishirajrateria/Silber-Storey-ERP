'use client';
import { MomPage } from '@/components/public';
export default function Page({ params }: { params: { token: string } }) { return <MomPage token={params.token} />; }
