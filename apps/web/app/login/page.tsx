'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { get, post } from '@/lib/api';
import { Button, Glass, Select } from '@/components/ui';
import { ROLE_HOME } from '@app/shared';

function LoginInner() {
  const r = useRouter(); const sp = useSearchParams();
  const [users, setUsers] = useState<Array<{ email: string; name: string; role: string }>>([]);
  const [email, setEmail] = useState(''); const [err, setErr] = useState(sp.get('error') === 'NOT_AUTHORISED' ? 'Not authorised — ask Admin to add you.' : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { get('/me').then((m) => r.replace(ROLE_HOME[m.data.user.role as keyof typeof ROLE_HOME])).catch(() => {}); get('/auth/dev-users').then((u) => { setUsers(u.data); setEmail(u.data[0]?.email ?? ''); }).catch(() => {}); }, [r]);
  const dev = async () => { setBusy(true); setErr(''); try { const u = await post('/auth/dev-login', { email }); r.replace(ROLE_HOME[u.data.role as keyof typeof ROLE_HOME]); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return <main className="flex min-h-screen items-center justify-center p-4">
    <Glass strong className="w-full max-w-sm">
      <div className="mb-6"><div className="mb-3 h-10 w-10 rounded-xl bg-accent/90 shadow-soft" /><h1 className="text-[20px] font-semibold tracking-tight">Sign in</h1><p className="text-[13px] text-mute">Lead management & consultation</p></div>
      <a href="/api/v1/auth/google/start" className="btn-primary w-full">Continue with Google</a>
      {users.length > 0 && <div className="mt-6 border-t border-white/70 pt-4">
        <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-mute">Mock mode · pick a user</div>
        <Select value={email} onChange={(e) => setEmail(e.target.value)}>{users.map((u) => <option key={u.email} value={u.email}>{u.name} · {u.role}</option>)}</Select>
        <Button variant="ghost" className="mt-2 w-full" onClick={dev} loading={busy}>Sign in as selected user</Button>
      </div>}
      {err && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{err}</p>}
    </Glass>
  </main>;
}

export default function Login() { return <Suspense><LoginInner /></Suspense>; }
