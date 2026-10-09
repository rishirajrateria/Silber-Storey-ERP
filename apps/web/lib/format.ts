import { format, formatDistanceToNowStrict, isToday, isTomorrow } from 'date-fns';
export const inr = (n: number | null | undefined) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
export const dt = (d: string | Date | null | undefined) => (d ? format(new Date(d), 'd MMM yyyy, HH:mm') : '—');
export const dd = (d: string | Date | null | undefined) => (d ? format(new Date(d), 'd MMM yyyy') : '—');
export const ago = (d: string | Date | null | undefined) => (d ? formatDistanceToNowStrict(new Date(d), { addSuffix: true }) : '—');
export const dayLabel = (d: string | Date) => (isToday(new Date(d)) ? 'Today' : isTomorrow(new Date(d)) ? 'Tomorrow' : format(new Date(d), 'EEE d MMM'));
export const title = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const fromLocalInput = (s: string) => new Date(s).toISOString();
