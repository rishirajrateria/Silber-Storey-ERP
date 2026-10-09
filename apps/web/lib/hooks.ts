'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './api';
import { useStore } from './store';

export const useMe = () => useStore((s) => s.me);
export const useRole = () => useStore((s) => s.me?.user.role);
export const useStatuses = () => useQuery({ queryKey: ['statuses'], queryFn: () => get('/statuses').then((r) => r.data as any[]), staleTime: 300_000 });
export const useSources = () => useQuery({ queryKey: ['sources'], queryFn: () => get('/lead-sources').then((r) => r.data as any[]), staleTime: 300_000 });
export const useDirectory = () => useQuery({ queryKey: ['directory'], queryFn: () => get('/users/directory').then((r) => r.data as Array<{ id: string; name: string; role: string; email: string }>), staleTime: 300_000 });
export const useLead = (id: string) => useQuery({ queryKey: ['lead', id], queryFn: () => get(`/leads/${id}`).then((r) => r.data), enabled: !!id });
export const useInvalidate = () => { const qc = useQueryClient(); return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
export const userName = (dir: Array<{ id: string; name: string }> | undefined, id?: string | null) => dir?.find((u) => u.id === id)?.name ?? (id ? id.slice(-4) : '—');
