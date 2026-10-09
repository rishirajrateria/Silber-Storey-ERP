'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { get } from '@/lib/api';
import { ROLE_HOME } from '@app/shared';
export default function Home() {
  const r = useRouter();
  useEffect(() => { get('/me').then((m) => r.replace(ROLE_HOME[m.data.user.role as keyof typeof ROLE_HOME])).catch(() => r.replace('/login')); }, [r]);
  return null;
}
