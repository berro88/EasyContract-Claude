import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TOPICS, TOPIC_LABELS, type LibraryClause, type LibraryClauseVersion, type Me, type PlaybookPositionInput, type PlaybookSeries,
  type PlaybookVersion, type Topic,
} from '@easycontract/shared';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { Warning } from '../components/Warning.tsx';

type Tab = 'clauses' | 'playbooks';

export function Library() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'playbooks' ? 'playbooks' : 'clauses';
  const me = useApi<Me>('/me');
  const canEdit = !!me.data && ['owner', 'admin'].includes(me.data.role);
  return (
    <section>
      <h1>Library</h1>
      <p className="muted">Your company's approved clause wording and negotiating positions. Every change is saved as a new version.</p>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'clauses'} className={tab === 'clauses' ? 'is-active' : ''} onClick={() => setParams({ tab: 'clauses' })}>Clause library</button>
        <button role="tab" aria-selected={tab === 'playbooks'} className={tab === 'playbooks' ? 'is-active' : ''} onClick={() => setParams({ tab: 'playbooks' })}>Playbooks</button>
      </div>
      {!canEdit && me.data && <p className="muted small">Only owners and admins can change the library.</p>}
      {tab === 'clauses' ? <Clauses canEdit={canEdit} /> : <Playbooks canEdit={canEdit} />}
    </section>
  );
}

const ExampleBadge = () => <span className="chip chip--example" title="Illustrative only, not legal advice">Example</span>;

// ---------- Clauses ----------

function Clauses({ canEdit }: { canEdit: boolean }) {
  const list = useApi<LibraryClause[]>('/library/clauses');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (list.error) return <p className="error">{list.error}</p>;
  if (!list.data) return null;
  const byTopic = TOPICS.map((t) => ({ t, items: list.data!.filter((c) => c.topic === t) })).filter((g) => g.items.length);

  return (
    <div className="library">
      <div className="library__list">
        {canEdit && <button className="btn btn--primary" onClick={() => { setCreating(true); setOpenId(null); }}>New clause</button>}
        {byTopic.length === 0 && <p className="muted">No clauses yet.</p>}
        {byTopic.map(({ t, items }) => (
          <section key={t}>
            <h3>{TOPIC_LABELS[t]}</h3>
            <ul className="list">
              {items.map((c) => (
                <li key={c.id}>
                  <button className={`list__item list__btn ${openId === c.id ? 'is-selected' : ''}`} onClick={() => { setOpenId(c.id); setCreating(false); }}>
                    <span><strong>{c.title}</strong> {c.isExample && <ExampleBadge />}</span>
                    <span className="muted small">v{c.latest.version}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="library__detail">
        {creating && <ClauseForm onDone={(id) => { setCreating(false); setOpenId(id); void list.reload(); }} onCancel={() => setCreating(false)} />}
        {openId && !creating && <ClauseDetail id={openId} canEdit={canEdit} onChanged={list.reload} />}
        {!openId && !creating && <div className="card empty"><p>Pick a clause to see its wording and versions.</p></div>}
      </div>
    </div>
  );
}

function ClauseForm({ onDone, onCancel }: { onDone(id: string): void; onCancel(): void }) {
  const [topic, setTopic] = useState<Topic>('payment');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [guidance, setGuidance] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const c = await api<LibraryClause>('/library/clauses', { method: 'POST', body: JSON.stringify({ topic, title, text, guidance }) });
      onDone(c.id);
    } catch (err) { setError((err as Error).message); }
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>New clause</h2>
      <label className="field"><span>Topic</span>
        <select value={topic} onChange={(e) => setTopic(e.target.value as Topic)}>{TOPICS.map((t) => <option key={t} value={t}>{TOPIC_LABELS[t]}</option>)}</select>
      </label>
      <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></label>
      <label className="field"><span>Wording</span><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} required /></label>
      <label className="field"><span>Guidance (when to use it)</span><textarea rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="form__actions"><button className="btn btn--primary">Save as version 1</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function ClauseDetail({ id, canEdit, onChanged }: { id: string; canEdit: boolean; onChanged(): void }) {
  const c = useApi<LibraryClause & { versions: LibraryClauseVersion[] }>(`/library/clauses/${id}`);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [guidance, setGuidance] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (c.data) { setText(c.data.latest.text); setGuidance(c.data.latest.guidance); setEditing(false); } }, [c.data]);
  if (!c.data) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/library/clauses/${id}/versions`, { method: 'POST', body: JSON.stringify({ text, guidance }) });
      await c.reload();
      onChanged();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="card">
      <div className="row-between"><h2>{c.data.title} {c.data.isExample && <ExampleBadge />}</h2><span className="chip">{TOPIC_LABELS[c.data.topic]}</span></div>
      {c.data.isExample && <Warning>Example wording for trying the app. It is not legal advice; replace it with wording your lawyer has approved.</Warning>}
      {editing ? (
        <form className="form" onSubmit={save}>
          <label className="field"><span>Wording</span><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} required /></label>
          <label className="field"><span>Guidance</span><textarea rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} /></label>
          {error && <p className="error">{error}</p>}
          <div className="form__actions"><button className="btn btn--primary">Save as version {c.data.latest.version + 1}</button><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : (
        <>
          <blockquote className="passage">{c.data.latest.text}</blockquote>
          {c.data.latest.guidance && <p className="muted">{c.data.latest.guidance}</p>}
          {canEdit && <button className="btn" onClick={() => setEditing(true)}>Edit (saves a new version)</button>}
        </>
      )}
      <h3>Version history</h3>
      <ol className="versions">
        {c.data.versions.map((v) => (
          <li key={v.id}>
            <strong>Version {v.version}</strong> <span className="muted small">{v.createdAt.slice(0, 10)}{v.createdBy ? ` · ${v.createdBy}` : ''}</span>
            <div className="small">{v.text}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- Playbooks ----------

function Playbooks({ canEdit }: { canEdit: boolean }) {
  const list = useApi<PlaybookSeries[]>('/playbooks');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (list.error) return <p className="error">{list.error}</p>;
  if (!list.data) return null;
  const active = list.data.flatMap((s) => s.versions.map((v) => ({ ...v, name: s.name }))).find((v) => v.isActive);

  const act = async (path: string) => {
    setError(null);
    try { await api(path, { method: 'POST', body: '{}' }); await list.reload(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="library">
      <div className="library__list">
        <div className="card active-pb">
          <span>{active ? <>Reviews compare contracts to <strong>{active.name}</strong>, version {active.version}.</> : "No playbook is active, so reviews don't compare against one."}</span>
          {active && canEdit && <button className="btn btn--small" onClick={() => act('/playbooks/deactivate')}>Turn off</button>}
        </div>
        {canEdit && <button className="btn btn--primary" onClick={() => { setCreating(true); setOpenId(null); }}>New playbook</button>}
        {error && <p className="error">{error}</p>}
        {list.data.map((s) => (
          <section key={s.name}>
            <h3>{s.name} {s.isExample && <ExampleBadge />}</h3>
            <ul className="list">
              {s.versions.map((v) => (
                <li key={v.id}>
                  <div className={`list__item ${openId === v.id ? 'is-selected' : ''}`}>
                    <button className="list__btn--plain" onClick={() => { setOpenId(v.id); setCreating(false); }}>
                      <strong>Version {v.version}</strong> <span className="muted small">{v.positionCount} positions · {v.createdAt.slice(0, 10)}</span>
                    </button>
                    {v.isActive ? <span className="chip chip--active">Active</span> : canEdit && <button className="btn btn--small" onClick={() => act(`/playbooks/${v.id}/activate`)}>Use this version</button>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="library__detail">
        {creating && <PlaybookEditor onSaved={(id) => { setCreating(false); setOpenId(id); void list.reload(); }} onCancel={() => setCreating(false)} />}
        {openId && !creating && <PlaybookDetail id={openId} canEdit={canEdit} onSaved={(id) => { setOpenId(id); void list.reload(); }} />}
        {!openId && !creating && <div className="card empty"><p>Pick a playbook version to see its positions.</p></div>}
      </div>
    </div>
  );
}

function PlaybookDetail({ id, canEdit, onSaved }: { id: string; canEdit: boolean; onSaved(id: string): void }) {
  const pb = useApi<PlaybookVersion>(`/playbooks/${id}`);
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [id]);
  if (!pb.data) return null;
  if (editing) return <PlaybookEditor from={pb.data} onSaved={onSaved} onCancel={() => setEditing(false)} />;
  return (
    <div className="card">
      <div className="row-between"><h2>{pb.data.name} · v{pb.data.version}</h2>{pb.data.isActive && <span className="chip chip--active">Active</span>}</div>
      {pb.data.isExample && <Warning>Example positions for trying the app. They are not legal advice; replace them with positions your lawyer has approved.</Warning>}
      {pb.data.positions.map((p) => (
        <section key={p.topic} className="position">
          <h3>{TOPIC_LABELS[p.topic]}</h3>
          {p.preferredText && <p><span className="pos-label pos-label--pref">Preferred</span> {p.preferredText}</p>}
          {p.fallbackText && <p><span className="pos-label pos-label--fall">Fallback</span> {p.fallbackText}</p>}
          {p.redLine && <p><span className="pos-label pos-label--red">Red line</span> {p.redLine}</p>}
        </section>
      ))}
      {canEdit && <button className="btn" onClick={() => setEditing(true)}>Edit (saves version {pb.data.version + 1})</button>}
    </div>
  );
}

function PlaybookEditor({ from, onSaved, onCancel }: { from?: PlaybookVersion; onSaved(id: string): void; onCancel(): void }) {
  const [name, setName] = useState('');
  const [positions, setPositions] = useState<Record<Topic, PlaybookPositionInput>>(() =>
    Object.fromEntries(TOPICS.map((t) => [t, from?.positions.find((p) => p.topic === t) ?? { topic: t, preferredText: '', fallbackText: '', redLine: '' }])) as Record<Topic, PlaybookPositionInput>);
  const [error, setError] = useState<string | null>(null);
  const set = (t: Topic, field: keyof PlaybookPositionInput, value: string) => setPositions({ ...positions, [t]: { ...positions[t], [field]: value } });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const list = Object.values(positions).filter((p) => p.preferredText.trim() || p.fallbackText.trim() || p.redLine.trim());
    try {
      const saved = from
        ? await api<PlaybookVersion>(`/playbooks/${from.id}/versions`, { method: 'POST', body: JSON.stringify({ positions: list }) })
        : await api<PlaybookVersion>('/playbooks', { method: 'POST', body: JSON.stringify({ name, positions: list }) });
      onSaved(saved.id);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{from ? `${from.name}: new version ${from.version + 1}` : 'New playbook'}</h2>
      {!from && <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>}
      <p className="muted small">Fill in only the topics you have a position on. For red lines, put exact words that must never be accepted in "quotes".</p>
      {TOPICS.map((t) => {
        const p = positions[t];
        const filled = !!(p.preferredText || p.fallbackText || p.redLine);
        return (
          <details key={t} className="position-edit" open={filled}>
            <summary>{TOPIC_LABELS[t]} {filled && <span className="chip">set</span>}</summary>
            <label className="field"><span>Preferred wording</span><textarea rows={2} value={p.preferredText} onChange={(e) => set(t, 'preferredText', e.target.value)} /></label>
            <label className="field"><span>Fallback wording</span><textarea rows={2} value={p.fallbackText} onChange={(e) => set(t, 'fallbackText', e.target.value)} /></label>
            <label className="field"><span>Red line</span><textarea rows={2} value={p.redLine} onChange={(e) => set(t, 'redLine', e.target.value)} /></label>
          </details>
        );
      })}
      {error && <p className="error">{error}</p>}
      <div className="form__actions"><button className="btn btn--primary">{from ? `Save as version ${from.version + 1}` : 'Save as version 1'}</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
