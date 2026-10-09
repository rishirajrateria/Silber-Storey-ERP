'use client';
import { ClientDetail } from '@/components/admin';
export default function Page({ params }: { params: { id: string } }) { return <ClientDetail id={params.id} />; }
