'use client';
import { InvitePage } from '@/components/public';
export default function Page({ params }: { params: { token: string } }) { return <InvitePage token={params.token} />; }
