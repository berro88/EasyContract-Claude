import { useEffect, useState, type FormEvent } from 'react';
import type { CompanyProfile } from '@easycontract/shared';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { usePrefs } from '../lib/prefs.tsx';

const FIELDS: { key: keyof CompanyProfile; label: string; hint?: string; type?: string }[] = [
  { key: 'name', label: 'Company name', hint: 'The name people know you by.' },
  { key: 'legalName', label: 'Registered legal name', hint: 'Exactly as registered. Used later to pre-fill contracts.' },
  { key: 'registrationNumber', label: 'Registration number' },
  { key: 'address', label: 'Registered address' },
  { key: 'country', label: 'Country' },
  { key: 'industry', label: 'Industry' },
  { key: 'contactEmail', label: 'Contact email', type: 'email' },
];

export function CompanyProfilePage() {
  const { t } = usePrefs();
  const { data, error } = useApi<CompanyProfile>('/tenant/profile');
  const [form, setForm] = useState<CompanyProfile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setStatus(null);
    try {
      setForm(await api<CompanyProfile>('/tenant/profile', { method: 'PUT', body: JSON.stringify(form) }));
      setStatus(t('profileSaved'));
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div className="card">{error}</div>;
  if (!form) return null;
  return (
    <section className="card narrow">
      <h1>Company profile</h1>
      <p className="muted">These details will pre-fill the contracts you create.</p>
      <form onSubmit={submit} className="form">
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <input type={f.type ?? 'text'} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} required={f.key === 'name'} />
            {f.hint && <small className="muted">{f.hint}</small>}
          </label>
        ))}
        <div className="form__actions">
          <button className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {status && <span role="status">{status}</span>}
        </div>
      </form>
    </section>
  );
}
