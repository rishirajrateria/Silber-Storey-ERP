'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Calendar, CheckSquare, Home, LayoutGrid, LogOut, Menu, MoreHorizontal, Search, Users, AlertTriangle, BarChart3, Settings, FileText, Bot, Briefcase, Inbox, Shield, Eye, WifiOff, Database, MessageSquare, MapPin, Activity, Smartphone } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useStore, type Me } from '@/lib/store';
import { cn, Spinner } from '@/components/ui';
import { ago } from '@/lib/format';
import { ns } from '@/lib/socket';

type Item = { href: string; label: string; icon: any };
const NAV: Record<string, Item[]> = {
  sales: [{ href: '/sales', label: 'Overview', icon: Home }, { href: '/sales/my-day', label: 'My Day', icon: CheckSquare }, { href: '/sales/leads', label: 'Leads', icon: Users }, { href: '/sales/calendar', label: 'Calendar', icon: Calendar }, { href: '/sales/approvals', label: 'Approvals', icon: Inbox }, { href: '/sales/delays', label: 'Delays', icon: AlertTriangle }, { href: '/sales/stats', label: 'Stats', icon: BarChart3 }],
  engineer: [{ href: '/engineer', label: 'Overview', icon: Home }, { href: '/engineer/my-day', label: 'My Day', icon: CheckSquare }, { href: '/engineer/leads', label: 'Leads', icon: Users }, { href: '/engineer/calendar', label: 'Calendar', icon: Calendar }, { href: '/engineer/approvals', label: 'Approvals', icon: Inbox }, { href: '/engineer/delays', label: 'Delays', icon: AlertTriangle }, { href: '/engineer/stats', label: 'Stats', icon: BarChart3 }],
  finance: [{ href: '/finance', label: 'Overview', icon: Home }, { href: '/finance/my-day', label: 'My Day', icon: CheckSquare }, { href: '/finance/leads', label: 'Leads', icon: Users }, { href: '/finance/approvals', label: 'Approvals', icon: Inbox }, { href: '/finance/delays', label: 'Delays', icon: AlertTriangle }, { href: '/finance/stats', label: 'Stats', icon: BarChart3 }],
  design_head: [{ href: '/design', label: 'Overview', icon: Home }, { href: '/design/my-day', label: 'My Day', icon: CheckSquare }, { href: '/design/leads', label: 'Projects', icon: Briefcase }, { href: '/design/calendar', label: 'Calendar', icon: Calendar }, { href: '/design/stats', label: 'Stats', icon: BarChart3 }],
  junior_designer: [{ href: '/design', label: 'Overview', icon: Home }, { href: '/design/my-day', label: 'My Day', icon: CheckSquare }, { href: '/design/leads', label: 'Projects', icon: Briefcase }, { href: '/design/calendar', label: 'Calendar', icon: Calendar }, { href: '/design/stats', label: 'Stats', icon: BarChart3 }],
  admin: [{ href: '/admin', label: 'Overview', icon: Home }, { href: '/admin/approvals', label: 'Approvals', icon: Inbox }, { href: '/admin/delays', label: 'Delays', icon: AlertTriangle }, { href: '/admin/projects', label: 'Projects', icon: Briefcase }, { href: '/admin/live', label: 'Live map', icon: MapPin }, { href: '/admin/activity', label: 'Activity', icon: Activity }, { href: '/admin/d/sales', label: 'Dashboards', icon: LayoutGrid }, { href: '/admin/clients', label: 'Clients', icon: Users }, { href: '/admin/lost-leads', label: 'Lost leads', icon: Eye }, { href: '/admin/messages', label: 'Messages', icon: MessageSquare }, { href: '/admin/templates', label: 'Templates', icon: FileText }, { href: '/admin/reports', label: 'Reports', icon: BarChart3 }, { href: '/admin/ai', label: 'AI assistant', icon: Bot }, { href: '/admin/audit', label: 'Audit', icon: Shield }, { href: '/admin/admins', label: 'Admins', icon: Database }, { href: '/admin/settings', label: 'Settings', icon: Settings }],
};
const MOBILE: Record<string, Item[]> = {
  sales: [NAV.sales[1], NAV.sales[2], NAV.sales[3], NAV.sales[4]], engineer: [NAV.engineer[1], NAV.engineer[2], NAV.engineer[3], NAV.engineer[4]], finance: [NAV.finance[1], NAV.finance[2], NAV.finance[3], NAV.finance[4]],
  design_head: [NAV.design_head[1], NAV.design_head[2], NAV.design_head[3], NAV.design_head[0]], junior_designer: [NAV.junior_designer[1], NAV.junior_designer[2], NAV.junior_designer[3], NAV.junior_designer[0]], admin: [NAV.admin[0], NAV.admin[3], NAV.admin[1], NAV.admin[2]],
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const r = useRouter(); const path = usePathname();
  const { me, setMe, online, queued } = useStore();
  const [open, setOpen] = useState(false); const [bell, setBell] = useState(false); const [more, setMore] = useState(false);
  useEffect(() => { get<Me>('/me').then((m) => { setMe(m.data); const hex = m.data.settings?.branding?.colors?.primary; if (/^#[0-9a-f]{6}$/i.test(hex ?? '')) { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; /* dark UI: only bright brand colours are legible as the accent */ if (lum >= 0.45) document.documentElement.style.setProperty('--accent', `${r} ${g} ${b}`); } }).catch(() => r.replace('/login')); }, [r, setMe]);
  // location ping every 60 s while visible and consented (6.4)
  useEffect(() => {
    if (!me?.locationConsentAt || !('geolocation' in navigator)) return;
    const ping = () => { if (document.visibilityState !== 'visible') return; navigator.geolocation.getCurrentPosition((p) => post('/me/location', { lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => {}), () => {}, { maximumAge: 30000 }); };
    ping(); const t = setInterval(ping, 60000); return () => clearInterval(t);
  }, [me?.locationConsentAt]);
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => get('/notifications').then((x) => x.data as any[]), enabled: !!me, refetchInterval: 60000 });
  useEffect(() => { if (!me) return; const s = ns('/notify'); const h = () => notes.refetch(); s.on('notification', h); return () => { s.off('notification', h); }; }, [me, notes]);
  if (!me) return <Spinner />;
  const role = me.user.role; const items = NAV[role]; const mobile = MOBILE[role];
  const unread = notes.data?.filter((n) => !n.readAt).length ?? 0;
  const active = (href: string) => (href === items[0].href ? path === href : path.startsWith(href));
  const logout = async () => { await post('/auth/logout'); setMe(null); r.replace('/login'); };
  return <div className="flex min-h-screen">
    {/* left rail */}
    <aside className={cn('fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col p-3 lg:flex', open && '!flex')}>
      <div className="glass flex h-full flex-col p-3">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1"><div className="h-8 w-8 rounded-lg bg-gradient-to-br from-accent to-[#8b78ff] shadow-soft" /><div className="min-w-0"><div className="truncate text-[13.5px] font-semibold">{me.settings?.branding?.companyName ?? 'Lead Manager'}</div><div className="truncate text-[10.5px] uppercase tracking-[.12em] text-mute">{role.replace('_', ' ')}</div></div></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto">{items.map((it) => <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className={cn('nav-item', active(it.href) && 'active')}><it.icon className="h-4 w-4" />{it.label}</Link>)}</nav>
        <Link href="/sessions" className={cn('nav-item mt-2', path === '/sessions' && 'active')}><Smartphone className="h-4 w-4" />Sessions & devices</Link>
        <button onClick={logout} className="nav-item text-mute"><LogOut className="h-4 w-4" />Sign out</button>
      </div>
    </aside>
    {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}
    <div className="flex min-w-0 flex-1 flex-col lg:pl-[232px]">
      {/* top bar */}
      <header className="sticky top-0 z-20 px-3 pt-3 sm:px-5">
        <div className="glass flex items-center gap-2 px-3 py-2">
          <button className="rounded-lg p-1.5 hover:bg-white/10 lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value; r.push(`${items.find((i) => i.href.endsWith('/leads'))?.href ?? '/admin/clients'}?q=${encodeURIComponent(q)}`); }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" /><input name="q" placeholder="Search leads by name, phone, email" className="field h-9 pl-9" />
          </form>
          <div className="relative"><button className="relative rounded-lg p-2 text-mute hover:bg-white/10 hover:text-ink" onClick={() => setBell((b) => !b)}><Bell className="h-5 w-5" />{unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent shadow-soft" />}</button>
            {bell && <div className="glass-strong absolute right-0 top-11 z-30 w-[320px] p-2"><div className="mb-1 flex items-center justify-between px-2 py-1 text-[12px] text-mute"><span>Notifications</span><button onClick={() => post('/notifications/read-all').then(() => notes.refetch())}>Mark all read</button></div>
              <div className="max-h-[360px] overflow-y-auto">{(notes.data ?? []).slice(0, 30).map((n) => <Link key={n.id} href={n.link ?? '#'} onClick={() => { post(`/notifications/${n.id}/read`).then(() => notes.refetch()); setBell(false); }} className={cn('block rounded-lg px-2 py-2 hover:bg-white/10', !n.readAt && 'bg-accent/[.06]')}><div className="text-[13px] font-medium">{n.title}</div><div className="truncate text-[12px] text-mute">{n.body}</div><div className="text-[11px] text-mute">{ago(n.at)}</div></Link>)}{!notes.data?.length && <div className="p-4 text-center text-[12.5px] text-mute">No notifications</div>}</div></div>}
          </div>
          <div className="hidden items-center gap-2 pl-1 sm:flex"><div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[.18] bg-gradient-to-br from-accent/35 to-[#8b78ff]/35 text-[11px] font-semibold">{me.user.name.split(' ').map((s) => s[0]).join('').slice(0, 2)}</div><div className="hidden text-[12.5px] leading-tight md:block"><div className="font-medium">{me.user.name}</div><div className="text-mute">{me.user.email}</div></div></div>
        </div>
        {(!online || queued > 0) && <div className="mt-2 flex items-center gap-2 rounded-xl border border-amber-300/35 bg-amber-400/10 px-3 py-1.5 text-[12.5px] text-amber-300"><WifiOff className="h-4 w-4" />{online ? `Syncing ${queued} queued change${queued > 1 ? 's' : ''}…` : `You are offline${queued ? ` · ${queued} change${queued > 1 ? 's' : ''} queued` : ''}`}</div>}
      </header>
      <main className="flex-1 px-3 pb-24 pt-4 sm:px-5 lg:pb-8"><Suspense fallback={<Spinner />}>{children}</Suspense></main>
      {/* mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 p-2 lg:hidden"><div className="glass-strong flex justify-around p-1">
        {mobile.map((it) => <Link key={it.href} href={it.href} className={cn('flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px]', active(it.href) ? 'text-accent' : 'text-mute')}><it.icon className="h-5 w-5" />{it.label}</Link>)}
        <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] text-mute"><MoreHorizontal className="h-5 w-5" />More</button>
      </div></nav>
      {more && <div className="fixed inset-0 z-40 flex items-end bg-black/50 lg:hidden" onClick={() => setMore(false)}><div className="glass-strong w-full rounded-b-none p-3" onClick={(e) => e.stopPropagation()}><div className="grid grid-cols-2 gap-1">{items.map((it) => <Link key={it.href} href={it.href} onClick={() => setMore(false)} className={cn('nav-item', active(it.href) && 'active')}><it.icon className="h-4 w-4" />{it.label}</Link>)}<Link href="/sessions" onClick={() => setMore(false)} className="nav-item"><Smartphone className="h-4 w-4" />Sessions</Link><button onClick={logout} className="nav-item text-mute"><LogOut className="h-4 w-4" />Sign out</button></div></div></div>}
    </div>
  </div>;
}
