'use client';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { X, Loader2, Inbox, ChevronDown } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
export const cn = (...a: Array<string | false | null | undefined>) => twMerge(clsx(a));

export function Glass({ className, children, strong }: { className?: string; children: ReactNode; strong?: boolean }) { return <div className={cn(strong ? 'glass-strong' : 'glass', 'p-5', className)}>{children}</div>; }

export function Button({ variant = 'primary', loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean }) {
  return <button className={cn(variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost', className)} disabled={p.disabled || loading} {...p}>{loading && <Loader2 className="h-4 w-4 animate-spin" />}{children}</button>;
}
/** Disabled primary action with tooltip explaining the blocking rule (Section 6.1). */
export function RuleButton({ blocked, children, ...p }: Parameters<typeof Button>[0] & { blocked?: string | null }) {
  return <span className="group relative inline-flex">{/* tooltip */}<Button {...p} disabled={p.disabled || !!blocked}>{children}</Button>{blocked && <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-max max-w-[260px] -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-[12px] text-white shadow-lg group-hover:block">{blocked}</span>}</span>;
}
export function Input({ className, label, error, ...p }: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  return <label className="block">{label && <span className="label">{label}</span>}<input className={cn('field', error && 'border-red-400', className)} {...p} />{error && <span className="mt-1 block text-[12px] text-red-600">{error}</span>}</label>;
}
export function Textarea({ className, label, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return <label className="block">{label && <span className="label">{label}</span>}<textarea className={cn('field min-h-[88px]', className)} {...p} /></label>;
}
export function Select({ className, label, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return <label className="block">{label && <span className="label">{label}</span>}<span className="relative block"><select className={cn('field appearance-none pr-8', className)} {...p}>{children}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" /></span></label>;
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2 text-[13.5px]"><span className={cn('relative h-5 w-9 rounded-full transition', checked ? 'bg-accent' : 'bg-ink/15')}><span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} /></span>{label}</button>;
}

const CHIP_COLORS: Record<string, string> = {
  gray: 'border-ink/10 bg-ink/5 text-ink/70', blue: 'border-blue-200 bg-blue-50 text-blue-800', green: 'border-emerald-200 bg-emerald-50 text-emerald-800', amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-red-200 bg-red-50 text-red-800', violet: 'border-violet-200 bg-violet-50 text-violet-800', accent: 'border-accent/20 bg-accent/10 text-accent',
};
export function Chip({ color = 'gray', children, className }: { color?: keyof typeof CHIP_COLORS; children: ReactNode; className?: string }) { return <span className={cn('chip', CHIP_COLORS[color], className)}>{children}</span>; }
/** Status chip colour-coded (config-driven by key). */
export function StatusChip({ status }: { status?: { key: string; label: string; isFinal?: boolean; isSystem?: boolean } | null }) {
  if (!status) return <Chip>—</Chip>;
  const k = status.key;
  const color = k === 'lost' ? 'red' : k.includes('paid') || k === 'handover_complete' || k === 'seems_positive' ? 'green' : k.includes('waiting') || k.includes('pending') || k === 'no_status' ? 'amber' : status.isSystem ? 'violet' : 'blue';
  return <Chip color={color}>{status.label}</Chip>;
}
export function StageBadge({ stage }: { stage: string }) { return <Chip color="accent" className="font-mono text-[11px]">{stage.replace(/_/g, ' ')}</Chip>; }

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/20 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
    <div className={cn('glass-strong max-h-[92vh] w-full overflow-y-auto rounded-b-none p-5 sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><h3 className="text-[16px] font-semibold">{title}</h3><button onClick={onClose} className="rounded-lg p-1 text-mute hover:bg-ink/5"><X className="h-4 w-4" /></button></div>{children}
    </div></div>;
}
const TabsCtx = createContext<{ value: string; set: (v: string) => void }>({ value: '', set: () => {} });
export function Tabs({ value, onChange, tabs, children }: { value: string; onChange: (v: string) => void; tabs: Array<{ key: string; label: string; count?: number }>; children: ReactNode }) {
  return <TabsCtx.Provider value={{ value, set: onChange }}>
    <div className="glass-soft mb-4 flex gap-1 overflow-x-auto p-1">{tabs.map((t) => <button key={t.key} onClick={() => onChange(t.key)} className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition', value === t.key ? 'bg-white text-accent shadow-soft' : 'text-ink/70 hover:bg-white/50')}>{t.label}{t.count != null && <span className="ml-1.5 rounded-full bg-ink/8 px-1.5 text-[11px]">{t.count}</span>}</button>)}</div>
    {children}
  </TabsCtx.Provider>;
}
export function Tab({ id, children }: { id: string; children: ReactNode }) { const c = useContext(TabsCtx); return c.value === id ? <>{children}</> : null; }

export function Table({ head, rows, empty = 'Nothing here yet', className }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string; className?: string }) {
  return <div className={cn('glass overflow-x-auto p-0', className)}><table className="w-full min-w-[560px] text-[13.5px]"><thead className="border-b border-white/70"><tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
    <tbody>{rows.length === 0 ? <tr><td colSpan={head.length}><Empty text={empty} /></td></tr> : rows.map((r, i) => <tr key={i} className="border-b border-white/50 last:border-0 hover:bg-white/40">{r.map((c, j) => <td key={j} className="td">{c}</td>)}</tr>)}</tbody></table></div>;
}
export function Empty({ text }: { text: string }) { return <div className="flex flex-col items-center gap-2 py-10 text-mute"><Inbox className="h-6 w-6 opacity-50" /><span className="text-[13px]">{text}</span></div>; }
export function Spinner() { return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-mute" /></div>; }
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) { return <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>{sub && <div className="mt-0.5 text-[13px] text-mute">{sub}</div>}</div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>; }
export function KV({ k, v }: { k: string; v: ReactNode }) { return <div className="min-w-0"><div className="text-[11.5px] font-medium uppercase tracking-wide text-mute">{k}</div><div className="truncate text-[14px]">{v ?? '—'}</div></div>; }
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) { return <div className="glass p-4"><div className="text-[12px] font-medium uppercase tracking-wide text-mute">{label}</div><div className="mt-1 text-[24px] font-semibold tracking-tight">{value}</div>{hint && <div className="text-[12px] text-mute">{hint}</div>}</div>; }
export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="mt-3 flex items-center justify-between text-[12.5px] text-mute"><span>{total} total</span><div className="flex items-center gap-2"><Button variant="ghost" className="h-8" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Button><span>{page} / {pages}</span><Button variant="ghost" className="h-8" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button></div></div>;
}
export function useConfirm() {
  const [state, set] = useState<{ title: string; text?: string; typed?: string; resolve: (v: string | null) => void } | null>(null);
  const [value, setValue] = useState('');
  const confirm = (title: string, text?: string, typed?: string) => new Promise<string | null>((resolve) => { setValue(''); set({ title, text, typed, resolve }); });
  const el = state ? <Dialog open onClose={() => { state.resolve(null); set(null); }} title={state.title}>
    {state.text && <p className="mb-3 text-[13.5px] text-ink/80">{state.text}</p>}
    {state.typed && <Input label={`Type "${state.typed}" to confirm`} value={value} onChange={(e) => setValue(e.target.value)} />}
    <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => { state.resolve(null); set(null); }}>Cancel</Button><Button variant="danger" disabled={!!state.typed && value !== state.typed} onClick={() => { state.resolve(state.typed ? value : 'ok'); set(null); }}>Confirm</Button></div>
  </Dialog> : null;
  return { confirm, el };
}
