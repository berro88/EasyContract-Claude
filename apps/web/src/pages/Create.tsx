import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  SEVERITY_LABELS, TOPIC_LABELS, type ContractTypeInfo, type DraftPreview, type DraftSummary, type WizardQuestion,
} from '@easycontract/shared';
import { api, download } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { usePrefs } from '../lib/prefs.tsx';
import { Warning } from '../components/Warning.tsx';
import { POLICY_DISCLAIMER } from '../lib/warnings.ts';

const ICONS: Record<string, string> = { service_agreement: '🛠️', supply: '📦', nda: '🤐', employment: '🧑‍💼', lease: '🏢', sales_terms: '🧾' };

/** Step 1: pick a contract type, or carry on with a saved draft. */
export function CreateStart() {
  const { t } = usePrefs();
  const navigate = useNavigate();
  const types = useApi<ContractTypeInfo[]>('/wizard/types');
  const drafts = useApi<DraftSummary[]>('/drafts');
  const [error, setError] = useState<string | null>(null);

  async function start(type: string) {
    setError(null);
    try {
      const res = await api<{ draft: DraftSummary }>('/drafts', { method: 'POST', body: JSON.stringify({ type }) });
      navigate(`/create/${res.draft.id}`);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <section>
      <h1>{t('createTitle')}</h1>
      <p className="lead">Pick the kind of contract. You'll answer plain-English questions, and we'll assemble a draft you can edit.</p>
      {error && <Warning tone="danger">{error}</Warning>}
      <div className="choice-grid">
        {types.data?.map((ct) => (
          <button key={ct.id} className="choice choice--button" onClick={() => start(ct.id)}>
            <span className="choice__icon" aria-hidden>{ICONS[ct.id]}</span>
            <h2>{ct.label}</h2>
            <p>{ct.description}</p>
            <span className="choice__go">Start →</span>
          </button>
        ))}
      </div>
      {!!drafts.data?.length && (
        <>
          <h2>Your drafts</h2>
          <ul className="list">
            {drafts.data.map((d) => (
              <li key={d.id}>
                <Link to={`/create/${d.id}`} className="list__item"><strong>{d.title}</strong><span className="muted small">Saved {d.updatedAt.slice(0, 10)}</span></Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

type Answers = Record<string, string>;

/** Steps 2 and 3: answer questions group by group, then review the draft. */
export function DraftWizard() {
  const { draftId } = useParams();
  const loaded = useApi<{ draft: DraftSummary; type: ContractTypeInfo; answers: Answers }>(`/drafts/${draftId}`);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [step, setStep] = useState(0);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const timer = useRef<number>();

  useEffect(() => { if (loaded.data && !answers) setAnswers(loaded.data.answers); }, [loaded.data, answers]);

  const type = loaded.data?.type;
  const groups = useMemo(() => (type ? [...new Set(type.questions.map((q) => q.group))] : []), [type]);
  const isReview = step === groups.length;

  // Saves a moment after typing stops.
  function update(id: string, value: string) {
    const next = { ...answers!, [id]: value };
    setAnswers(next);
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try { await api(`/drafts/${draftId}`, { method: 'PUT', body: JSON.stringify({ answers: next }) }); setSaveState('saved'); } catch { setSaveState('error'); }
    }, 500);
  }

  if (loaded.error) return <div className="card">{loaded.error}</div>;
  if (!type || !answers) return null;
  const visible = (q: WizardQuestion) => !q.showIf || answers[q.showIf.question] === q.showIf.equals;

  return (
    <section>
      <Link to="/create" className="back">← All contract types</Link>
      <div className="row-between">
        <h1>{type.label}</h1>
        <span className="muted small" role="status">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? "Couldn't save. Check your connection." : 'All changes saved'}</span>
      </div>
      <ol className="steps">
        {groups.map((g, i) => (
          <li key={g} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}>
            <button className="steps__btn" onClick={() => setStep(i)}><span className="steps__n">{i + 1}</span> {g}</button>
          </li>
        ))}
        <li className={isReview ? 'is-current' : ''}>
          <button className="steps__btn" onClick={() => setStep(groups.length)}><span className="steps__n">✓</span> Review</button>
        </li>
      </ol>

      {!isReview && (
        <div className="card narrow">
          <h2>{groups[step]}</h2>
          <div className="form">
            {type.questions.filter((q) => q.group === groups[step] && visible(q)).map((q) => (
              <Question key={q.id} q={q} value={answers[q.id] ?? ''} onChange={(v) => update(q.id, v)} />
            ))}
          </div>
          <div className="form__actions wizard-nav">
            {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>← Back</button>}
            <button className="btn btn--primary" onClick={() => setStep(step + 1)}>{step === groups.length - 1 ? 'Review the draft →' : 'Next →'}</button>
          </div>
        </div>
      )}
      {isReview && <Review draftId={draftId!} saveState={saveState} onEdit={(questionId) => setStep(groups.indexOf(type.questions.find((q) => q.id === questionId)!.group))} />}
    </section>
  );
}

function Question({ q, value, onChange }: { q: WizardQuestion; value: string; onChange(v: string): void }) {
  const input = q.kind === 'textarea' ? <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    : q.kind === 'select' || q.kind === 'yesno' ? (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {q.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
    : <input type={q.kind === 'date' ? 'date' : q.kind === 'number' ? 'number' : 'text'} min={q.kind === 'number' ? 0 : undefined} value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <label className="field">
      <span>{q.label}{q.essential && <span className="essential" title="Essential"> *</span>}</span>
      {input}
      {q.help && <small className="muted">{q.help}</small>}
      {q.prefill && <small className="muted">Pre-filled from your company profile.</small>}
      {q.protective && (
        <small className="protective">
          <strong>Protective choice{q.options ? `: ${q.options.find((o) => o.value === q.protective!.answer)?.label ?? ''}` : ''}.</strong> {q.protective.why}
        </small>
      )}
    </label>
  );
}

function Review({ draftId, saveState, onEdit }: { draftId: string; saveState: string; onEdit(questionId: string): void }) {
  const p = useApi<DraftPreview>(saveState === 'saved' ? `/drafts/${draftId}/preview` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const get = async (format: 'docx' | 'pdf') => {
    setBusy(format);
    setError(null);
    try { await download(`/drafts/${draftId}/export?format=${format}`); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  if (p.error) return <Warning tone="danger">{p.error}</Warning>;
  if (!p.data) return <p className="muted">Assembling your draft…</p>;
  const { sections, missing, findings } = p.data;

  return (
    <div className="draft">
      <div className="draft__main">
        {missing.length > 0 && (
          <Warning tone="danger" title={`${missing.length} essential ${missing.length === 1 ? 'answer is' : 'answers are'} missing`}>
            <ul className="missing">
              {missing.map((m) => <li key={m.questionId}><button className="linklike" onClick={() => onEdit(m.questionId)}>{m.label}</button></li>)}
            </ul>
            They show as "[NOT PROVIDED: …]" in the draft.
          </Warning>
        )}
        <div className="card draft__doc">
          {sections.map((s) => (
            <section key={s.id} className="draft__clause">
              <h3>{s.number}. {s.heading} {s.topic && <span className="chip">{TOPIC_LABELS[s.topic]}</span>}</h3>
              <p className="draft__text">{highlightMissing(s.text)}</p>
              <p className="muted small">{s.explanation}</p>
              <p className={`source source--${s.source.kind}`}>{s.source.label}</p>
              {s.protective && <p className="protective small"><strong>Protective:</strong> {s.protective}</p>}
              {s.loophole && <p className="loophole small"><strong>Watch for:</strong> {s.loophole}</p>}
            </section>
          ))}
        </div>
      </div>
      <aside className="draft__side">
        <div className="card">
          <h3>Download</h3>
          <p className="muted small">An editable draft for review. It includes drafting notes at the end to remove before sending.</p>
          <div className="exports">
            <button className="btn btn--primary btn--small" disabled={!!busy} onClick={() => get('docx')}>{busy === 'docx' ? 'Preparing…' : 'Word'}</button>
            <button className="btn btn--small" disabled={!!busy} onClick={() => get('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
          </div>
          {error && <p className="error small">{error}</p>}
        </div>
        <div className="card">
          <h3>Risk checks</h3>
          <p className="muted small">The same checks as a contract review.</p>
          {findings.findings.length === 0 && <p className="muted">Nothing found.</p>}
          {findings.findings.map((f) => (
            <div key={f.id} className={`finding finding--${f.severity} finding--compact`}>
              <span className={`sev sev--${f.severity}`}>{SEVERITY_LABELS[f.severity]}</span>
              <strong>{f.title}</strong>
              <p className="small">{f.plain}</p>
            </div>
          ))}
        </div>
        <p className="disclaimer">{POLICY_DISCLAIMER}</p>
      </aside>
    </div>
  );
}

/** Shows "[NOT PROVIDED: …]" markers clearly. */
function highlightMissing(text: string) {
  return text.split(/(\[NOT PROVIDED:[^\]]*\])/g).map((part, i) => (part.startsWith('[NOT PROVIDED') ? <mark key={i} className="missing-mark">{part}</mark> : part));
}
