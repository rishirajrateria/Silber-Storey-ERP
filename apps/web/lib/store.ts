'use client';
import { create } from 'zustand';
import type { Role } from '@app/shared';

export interface Me { user: { id: string; email: string; name: string; role: Role; permissions: Array<{ dashboard: string; level: string; canApprove: boolean }> }; locationConsentAt: string | null; settings: any; mockMode: boolean }
interface State { me: Me | null; setMe: (m: Me | null) => void; online: boolean; setOnline: (o: boolean) => void; queued: number; setQueued: (n: number) => void; toast: { id: number; text: string; kind: 'ok' | 'err' } | null; notify: (text: string, kind?: 'ok' | 'err') => void }
export const useStore = create<State>((set) => ({
  me: null, setMe: (me) => set({ me }), online: true, setOnline: (online) => set({ online }), queued: 0, setQueued: (queued) => set({ queued }),
  toast: null, notify: (text, kind = 'ok') => { const id = Date.now(); set({ toast: { id, text, kind } }); setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : {})), 3500); },
}));
export const toast = (text: string, kind: 'ok' | 'err' = 'ok') => useStore.getState().notify(text, kind);
export const errToast = (e: any) => toast(e?.message ?? 'Something went wrong', 'err');
