'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { cn } from './ui';
import { replayQueue, refreshCount } from '@/lib/offline';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } } }));
  const toast = useStore((s) => s.toast);
  const setOnline = useStore((s) => s.setOnline);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); replayQueue().then(() => qc.invalidateQueries()); }; const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off); refreshCount().catch(() => {});
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [qc, setOnline]);
  return <QueryClientProvider client={qc}>{children}
    {toast && <div className={cn('fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-2 text-[13px] text-black shadow-lg sm:bottom-6', toast.kind === 'err' ? 'bg-red-400' : 'bg-white')}>{toast.text}</div>}
  </QueryClientProvider>;
}
