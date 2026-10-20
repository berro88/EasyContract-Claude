import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '@easycontract/shared';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { usePrefs } from '../lib/prefs.tsx';
import { Steps } from '../components/Steps.tsx';

export function Projects({ startNew = false }: { startNew?: boolean }) {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const { data, error } = useApi<ProjectSummary[]>('/projects');
  const [showForm, setShowForm] = useState(startNew);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const p = await api<ProjectSummary>('/projects', { method: 'POST', body: JSON.stringify({ name, description }) });
      navigate(`/projects/${p.id}`);
    } catch (err) {
      setFormError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <section>
      {showForm ? (
        <div className="card narrow">
          <Steps current={1} />
          <h1>{t('newProject')}</h1>
          <p className="muted">A project holds one deal: the main agreement plus any amendments, letters or proposals that go with it.</p>
          <form className="form" onSubmit={create}>
            <label className="field">
              <span>Project name</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cleaning services with Acme" required maxLength={200} />
            </label>
            <label className="field">
              <span>Notes (optional)</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
            </label>
            {formError && <p className="error">{formError}</p>}
            <div className="form__actions">
              <button className="btn btn--primary" disabled={busy}>Continue →</button>
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="row-between">
          <h1>Projects</h1>
          <button className="btn btn--primary" onClick={() => setShowForm(true)}>{t('newProject')}</button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!showForm && data && data.length === 0 && <div className="card empty"><p>{t('noProjects')}</p></div>}
      {!showForm && data && data.length > 0 && (
        <ul className="list">
          {data.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`} className="list__item">
                <strong>{p.name}</strong>
                <span className="muted">{p.documentCount} document{p.documentCount === 1 ? '' : 's'} · {new Date(p.createdAt).toLocaleDateString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
