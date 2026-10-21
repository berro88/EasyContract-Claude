import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { POLICY_DISCLAIMER, POLICY_SECTIONS, POLICY_TITLE, POLICY_VERSION, ROLES } from '@easycontract/shared';
import { api, setDevUser, DEFAULT_DEV_USER } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { Warning } from '../components/Warning.tsx';
import { WARNINGS } from '../lib/warnings.ts';

const ROLE_LABELS: Record<(typeof ROLES)[number], string> = { owner: 'Owner', admin: 'Admin', reviewer: 'Reviewer', commenter: 'Commenter', read_only: 'Read only' };

/** The usage policy in a scroll box, with the acceptance tick box. */
export function PolicyConsent({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
  return (
    <div className="consent">
      <div className="consent__box" tabIndex={0} aria-label={POLICY_TITLE}>
        <strong>{POLICY_TITLE}, version {POLICY_VERSION}</strong>
        {POLICY_SECTIONS.map((s) => (
          <p key={s.heading}><strong>{s.heading}.</strong> {s.body}</p>
        ))}
      </div>
      <label className="consent__tick">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} required />
        <span>I have read and accept the usage policy (version {POLICY_VERSION}). I understand EasyContract is not a formal legal advisory tool.</span>
      </label>
    </div>
  );
}

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="auth">
      <div className="card auth__card">
        <h1>{title}</h1>
        {children}
      </div>
    </section>
  );
}

type SignupMode = 'open' | 'code' | 'closed';

export function Login() {
  const navigate = useNavigate();
  const config = useApi<{ signup: SignupMode }>('/auth/config');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setDevUser('off');
      navigate('/');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <AuthCard title="Sign in">
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {config.data?.signup === 'closed'
        ? <p className="muted">New here? Ask someone in your company to invite you from their Team page.</p>
        : <p className="muted">New here? <Link to="/signup">Create a company account</Link></p>}
      {import.meta.env.DEV && (
        <p className="muted small">
          Local development: <button className="linklike" onClick={() => { setDevUser(DEFAULT_DEV_USER); navigate('/'); }}>continue as the demo owner</button>
        </p>
      )}
    </AuthCard>
  );
}

export function Signup() {
  const navigate = useNavigate();
  const config = useApi<{ signup: SignupMode }>('/auth/config');
  const [form, setForm] = useState({ name: '', companyName: '', email: '', password: '', signupCode: '' });
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accepted) { setError('Please accept the usage policy to continue.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/signup', { method: 'POST', body: JSON.stringify({ ...form, acceptPolicyVersion: POLICY_VERSION }) });
      setDevUser('off');
      navigate('/profile');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (config.data?.signup === 'closed') {
    return (
      <AuthCard title="Sign-up is invite-only">
        <p>To join, ask someone in your company to invite you from their <strong>Team</strong> page. They'll send you a link.</p>
        <p className="muted">Already have an account? <Link to="/login">Sign in</Link></p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create a company account">
      <form className="form" onSubmit={submit}>
        {config.data?.signup === 'code' && (
          <label className="field">
            <span>Sign-up code</span>
            <input autoComplete="off" value={form.signupCode} onChange={set('signupCode')} required />
            <small className="muted">You get this from whoever set up EasyContract. Joining an existing company? Use their invite link instead.</small>
          </label>
        )}
        <label className="field"><span>Your name</span><input autoComplete="name" value={form.name} onChange={set('name')} required /></label>
        <label className="field"><span>Company name</span><input autoComplete="organization" value={form.companyName} onChange={set('companyName')} required /></label>
        <label className="field"><span>Email</span><input type="email" autoComplete="email" value={form.email} onChange={set('email')} required /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={set('password')} required /><small className="muted">At least 10 characters.</small></label>
        <Warning>{WARNINGS.draftPolicy}</Warning>
        <PolicyConsent checked={accepted} onChange={setAccepted} />
        {error && <p className="error">{error}</p>}
        <button className="btn btn--primary" disabled={busy || !accepted}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="muted">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthCard>
  );
}

export function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const info = useApi<{ companyName: string; email: string; role: (typeof ROLES)[number]; existingAccount: boolean }>(`/auth/invite/${token}`);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, name, password, acceptPolicyVersion: POLICY_VERSION }) });
      setDevUser('off');
      navigate('/');
    } catch (err) { setError((err as Error).message); }
  }

  if (info.error) return <AuthCard title="Invite"><Warning tone="danger">{info.error}</Warning></AuthCard>;
  if (!info.data) return null;
  return (
    <AuthCard title={`Join ${info.data.companyName}`}>
      <p>You've been invited as <strong>{ROLE_LABELS[info.data.role]}</strong> using <strong>{info.data.email}</strong>.</p>
      <form className="form" onSubmit={submit}>
        {!info.data.existingAccount && <label className="field"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label>}
        <label className="field">
          <span>{info.data.existingAccount ? 'Your existing password' : 'Choose a password'}</span>
          <input type="password" autoComplete={info.data.existingAccount ? 'current-password' : 'new-password'} minLength={info.data.existingAccount ? undefined : 10} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <PolicyConsent checked={accepted} onChange={setAccepted} />
        {error && <p className="error">{error}</p>}
        <button className="btn btn--primary" disabled={!accepted}>Join</button>
      </form>
    </AuthCard>
  );
}

/** Shown to signed-in people who haven't accepted the current policy version. */
export function PolicyGate({ onAccepted }: { onAccepted(): void }) {
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function accept() {
    try { await api('/policy/accept', { method: 'POST', body: JSON.stringify({ version: POLICY_VERSION }) }); onAccepted(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <AuthCard title="The usage policy has changed">
      <p>Please read and accept the current version to keep using EasyContract.</p>
      <p className="muted small">{POLICY_DISCLAIMER}</p>
      <PolicyConsent checked={accepted} onChange={setAccepted} />
      {error && <p className="error">{error}</p>}
      <button className="btn btn--primary" disabled={!accepted} onClick={accept}>Accept and continue</button>
    </AuthCard>
  );
}

export { ROLE_LABELS };
