import { useState, type FormEvent } from 'react';
import { ROLES, type Me, type Role } from '@easycontract/shared';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { ROLE_LABELS } from './Auth.tsx';

interface Member { id: string; name: string; email: string; role: Role; joinedAt: string }
interface Invite { id: string; email: string; role: Role; createdAt: string; expiresAt: string }

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including managing owners.',
  admin: 'Everything except managing owners.',
  reviewer: 'Upload, review, decide on findings, draft contracts.',
  commenter: 'Read and comment.',
  read_only: 'Read only.',
};

export function Team() {
  const me = useApi<Me>('/me');
  const members = useApi<Member[]>('/tenant/members');
  const canManage = !!me.data && ['owner', 'admin'].includes(me.data.role);
  const invites = useApi<Invite[]>(canManage ? '/tenant/invites' : null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('reviewer');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLink(null);
    try {
      const res = await api<{ link: string }>('/tenant/invites', { method: 'POST', body: JSON.stringify({ email, role }) });
      setLink(`${window.location.origin}${res.link}`);
      setEmail('');
      void invites.reload();
    } catch (err) { setError((err as Error).message); }
  }
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await Promise.all([members.reload(), invites.reload()]); } catch (err) { setError((err as Error).message); }
  };

  return (
    <section>
      <h1>Team</h1>
      <p className="muted">People in {me.data?.tenant.name ?? 'your company'} and what they can do.</p>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h2>Members</h2>
        <ul className="list">
          {members.data?.map((m) => (
            <li key={m.id} className="list__item">
              <div><strong>{m.name}</strong> <span className="muted small">{m.email}</span></div>
              {canManage && m.id !== me.data?.user.id
                ? (
                  <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => act(() => api(`/tenant/members/${m.id}`, { method: 'PUT', body: JSON.stringify({ role: e.target.value }) }))}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )
                : <span className="chip">{ROLE_LABELS[m.role]}</span>}
            </li>
          ))}
        </ul>
      </div>

      {canManage && (
        <div className="card">
          <h2>Invite someone</h2>
          <p className="muted small">No email is sent. Copy the link and send it to them yourself. It works once and expires in 14 days.</p>
          <form className="form invite-form" onSubmit={invite}>
            <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="field"><span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
              <small className="muted">{ROLE_HELP[role]}</small>
            </label>
            <div className="form__actions"><button className="btn btn--primary">Create invite link</button></div>
          </form>
          {link && (
            <div className="invite-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
              <button className="btn btn--small" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
            </div>
          )}
          {!!invites.data?.length && (
            <>
              <h3>Waiting to be accepted</h3>
              <ul className="list">
                {invites.data.map((i) => (
                  <li key={i.id} className="list__item">
                    <div><strong>{i.email}</strong> <span className="muted small">{ROLE_LABELS[i.role]} · expires {i.expiresAt.slice(0, 10)}</span></div>
                    <button className="btn btn--small" onClick={() => act(() => api(`/tenant/invites/${i.id}`, { method: 'DELETE' }))}>Withdraw</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
