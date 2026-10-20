import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  DOCUMENT_ROLE_LABELS, NEGOTIATION_LABELS, type CompareResponse, type CompareRowStatus, type DiffOp, type DocumentSummary,
  type DocumentVersionSummary, type EffectivePositionResponse, type IncorporationStatus, type InstructionState,
  type LetterMatchResponse, type PartyChange, type ProposedSignedResponse, type ProposedSignedStatus,
} from '@easycontract/shared';
import { useApi } from '../lib/useApi.ts';
import { Warning } from '../components/Warning.tsx';
import { POLICY_DISCLAIMER } from '../lib/warnings.ts';

type Mode = 'versions' | 'effective' | 'proposed' | 'letters';
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: 'versions', label: 'Compare versions', hint: 'See what changed between two versions. Renumbered clauses are matched by what they say.' },
  { key: 'effective', label: 'Agreement + amendments', hint: 'The base agreement with agreed amendments applied: what is in force now.' },
  { key: 'proposed', label: 'Proposed vs signed', hint: 'Proposed wording and signed wording side by side, never mixed together.' },
  { key: 'letters', label: 'Letters', hint: 'Which agreement and clause each letter is about.' },
];

const ready = (docs: DocumentSummary[]) => docs.filter((d) => d.latestVersion?.status === 'ready');

export function Compare() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const mode = (MODES.find((m) => m.key === params.get('mode'))?.key ?? 'versions') as Mode;
  const project = useApi<{ name: string; documents: DocumentSummary[] }>(`/projects/${projectId}`);

  if (project.error) return <div className="card">{project.error}</div>;
  if (!project.data) return null;
  const docs = ready(project.data.documents);

  return (
    <section>
      <Link to={`/projects/${projectId}`} className="back">← {project.data.name}</Link>
      <h1>Compare and reconcile</h1>
      <div className="tabs" role="tablist">
        {MODES.map((m) => (
          <button key={m.key} role="tab" aria-selected={mode === m.key} className={mode === m.key ? 'is-active' : ''} onClick={() => setParams({ mode: m.key })}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted">{MODES.find((m) => m.key === mode)!.hint}</p>
      {mode === 'versions' && <VersionsMode docs={docs} />}
      {mode === 'effective' && <EffectiveMode projectId={projectId!} docs={docs} />}
      {mode === 'proposed' && <ProposedMode docs={docs} />}
      {mode === 'letters' && <LettersMode docs={docs} />}
      <p className="disclaimer">{POLICY_DISCLAIMER}</p>
    </section>
  );
}

// ---------- Shared bits ----------

function DocSelect({ label, docs, value, onChange }: { label: string; docs: DocumentSummary[]; value: string; onChange(id: string): void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a document…</option>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title} ({DOCUMENT_ROLE_LABELS[d.role]}, {NEGOTIATION_LABELS[d.negotiationStatus]})
          </option>
        ))}
      </select>
    </label>
  );
}

function VersionSelect({ documentId, value, onChange }: { documentId: string; value: string; onChange(id: string): void }) {
  const doc = useApi<{ versions: DocumentVersionSummary[] }>(documentId ? `/documents/${documentId}` : null);
  const versions = doc.data?.versions.filter((v) => v.status === 'ready') ?? [];
  if (versions.length < 2) return null;
  return (
    <label className="field field--small">
      <span>Version</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Latest</option>
        {versions.map((v) => <option key={v.id} value={v.id}>Version {v.versionNumber} · {v.fileName}</option>)}
      </select>
    </label>
  );
}

function Redline({ diff }: { diff: DiffOp[] }) {
  return (
    <span className="redline">
      {diff.map((d, i) => d.op === 'same' ? <span key={i}>{d.text}</span> : d.op === 'add' ? <ins key={i}>{d.text}</ins> : <del key={i}>{d.text}</del>)}
    </span>
  );
}

function PartyWarnings({ changes }: { changes: PartyChange[] }) {
  return <>{changes.map((c) => <Warning key={c.leftBlockId + c.rightBlockId} title="Party name changed">{c.message}</Warning>)}</>;
}

const Num = ({ n }: { n: string | null }) => (n ? <span className="block__num">{n}</span> : null);

// ---------- Mode 1 ----------

const ROW_LABELS: Record<CompareRowStatus, string> = { unchanged: 'Unchanged', changed: 'Changed', renumbered: 'Renumbered', added: 'Added', removed: 'Removed' };

function VersionsMode({ docs }: { docs: DocumentSummary[] }) {
  // Default: two versions of the same document if there is one, else the first two documents.
  const multi = docs.find((d) => d.versionCount > 1);
  const [left, setLeft] = useState(multi?.id ?? docs[0]?.id ?? '');
  const [right, setRight] = useState(multi?.id ?? docs[1]?.id ?? '');
  const [leftVersion, setLeftVersion] = useState('');
  const [rightVersion, setRightVersion] = useState('');
  const [showUnchanged, setShowUnchanged] = useState(false);

  // Same document on both sides: start by comparing its first version with its latest.
  const first = useApi<{ versions: DocumentVersionSummary[] }>(left && left === right ? `/documents/${left}` : null);
  useEffect(() => {
    if (left === right && first.data && !leftVersion) {
      const oldest = first.data.versions.filter((v) => v.status === 'ready').at(-1);
      if (oldest) setLeftVersion(oldest.id);
    }
  }, [first.data, left, right, leftVersion]);

  const q = left && right ? `/compare?left=${left}&right=${right}${leftVersion ? `&leftVersion=${leftVersion}` : ''}${rightVersion ? `&rightVersion=${rightVersion}` : ''}` : null;
  const res = useApi<CompareResponse>(q);
  const rows = res.data?.rows.filter((r) => showUnchanged || r.status !== 'unchanged') ?? [];

  return (
    <>
      <div className="card picker">
        <div><DocSelect label="Older" docs={docs} value={left} onChange={(v) => { setLeft(v); setLeftVersion(''); }} /><VersionSelect documentId={left} value={leftVersion} onChange={setLeftVersion} /></div>
        <div><DocSelect label="Newer" docs={docs} value={right} onChange={(v) => { setRight(v); setRightVersion(''); }} /><VersionSelect documentId={right} value={rightVersion} onChange={setRightVersion} /></div>
      </div>
      {res.error && <Warning tone="danger">{res.error}</Warning>}
      {res.data && (
        <>
          {res.data.warnings.map((w) => <Warning key={w}>{w}</Warning>)}
          <PartyWarnings changes={res.data.partyChanges} />
          <div className="chips summary">
            {(Object.keys(ROW_LABELS) as CompareRowStatus[]).map((s) => <span key={s} className={`chip chip--${s}`}>{res.data!.summary[s]} {ROW_LABELS[s].toLowerCase()}</span>)}
            <label className="toggle"><input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} /> Show unchanged</label>
          </div>
          <div className="cmp">
            <div className="cmp__head"><span>{res.data.left.title} · v{res.data.left.versionNumber}</span><span>{res.data.right.title} · v{res.data.right.versionNumber}</span></div>
            {rows.length === 0 && <p className="muted">No differences.</p>}
            {rows.map((r, i) => (
              <div key={i} className={`cmp__row cmp__row--${r.status}`}>
                <div className="cmp__status">
                  <span className={`chip chip--${r.status}`}>{ROW_LABELS[r.status]}</span>
                  {r.renumbered && r.status === 'changed' && <span className="chip chip--renumbered">Renumbered</span>}
                  {r.renumbered && r.left && r.right && <span className="muted small">{r.left.clauseNumber ?? '—'} → {r.right.clauseNumber ?? '—'}</span>}
                </div>
                <div className="cmp__cell">{r.left && <><Num n={r.left.clauseNumber} />{r.left.text}</>}</div>
                <div className="cmp__cell">
                  {r.right && (r.diff ? <><Num n={r.right.clauseNumber} /><Redline diff={r.diff} /></> : <><Num n={r.right.clauseNumber} />{r.right.text}</>)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------- Mode 2 ----------

const INCORPORATION: Record<IncorporationStatus, string> = {
  incorporated: 'Fully incorporated', partly_incorporated: 'Partly incorporated', not_incorporated: 'Not incorporated', nothing_to_incorporate: 'No changes found',
};
const STATE: Record<InstructionState, string> = { incorporated: 'Already in the base', applied: 'Applied', pending: 'Not applied (not agreed)', cannot_apply: "Can't apply" };

function EffectiveMode({ projectId, docs }: { projectId: string; docs: DocumentSummary[] }) {
  const bases = docs.filter((d) => ['signed_copy', 'main_agreement'].includes(d.role));
  const preferred = bases.find((d) => d.role === 'signed_copy') ?? bases[0];
  const [base, setBase] = useState(preferred?.id ?? '');
  const res = useApi<EffectivePositionResponse>(base ? `/projects/${projectId}/effective?base=${base}` : null);

  if (!bases.length) return <div className="card empty"><p>Upload a main agreement or signed copy first.</p></div>;
  return (
    <>
      <div className="card picker"><DocSelect label="Base agreement" docs={bases} value={base} onChange={setBase} /></div>
      {res.error && <Warning tone="danger">{res.error}</Warning>}
      {res.data && (
        <>
          {res.data.baseWarning && <Warning>{res.data.baseWarning}</Warning>}
          {res.data.warnings.map((w) => <Warning key={w}>{w}</Warning>)}
          <PartyWarnings changes={res.data.partyChanges} />

          <h2>Amendments</h2>
          {res.data.amendments.length === 0 && <p className="muted">No amendments or addenda apply to this agreement.</p>}
          {res.data.amendments.map((a) => (
            <div key={a.document.documentId} className="card amendment">
              <div className="row-between">
                <strong>{a.document.title}</strong>
                <div className="chips">
                  <span className={`chip chip--neg-${a.negotiationStatus}`}>Negotiation: {NEGOTIATION_LABELS[a.negotiationStatus]}</span>
                  <span className={`chip chip--inc-${a.incorporation}`}>
                    {INCORPORATION[a.incorporation]}{a.instructionCount ? ` (${a.incorporatedCount} of ${a.instructionCount})` : ''}
                  </span>
                </div>
              </div>
              <ol className="instructions">
                {a.instructions.map((ins) => (
                  <li key={ins.index}>
                    <span className={`chip chip--state-${ins.state}`}>{STATE[ins.state]}</span>
                    <div>
                      <q className="instructions__src">{ins.sourceText}</q>
                      {ins.to && !ins.sourceText.includes(ins.to) && <span className="instructions__new">New wording: “{ins.to}”</span>}
                      <div className="muted small">{ins.explanation}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}

          <h2>Effective position</h2>
          <div className="card">
            {res.data.clauses.map((c, i) => (
              <div key={i} className={`eff ${c.changedBy.length ? 'eff--changed' : ''} ${c.deleted ? 'eff--deleted' : ''}`}>
                <div><Num n={c.clauseNumber} />{c.deleted ? <del>{c.text}</del> : c.text}</div>
                {c.changedBy.map((cb) => (
                  <span key={cb.documentId + cb.instructionIndex} className="eff__src">
                    {c.deleted ? 'Deleted' : c.baseBlockId ? 'Changed' : 'Added'} by {cb.title} (change {cb.instructionIndex})
                  </span>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------- Mode 3 ----------

const PS_LABELS: Record<ProposedSignedStatus, string> = {
  same: 'Same', changed_before_signing: 'Changed before signing', proposed_only: 'Proposed only: not agreed', signed_only: 'Only in the signed version',
};

function ProposedMode({ docs }: { docs: DocumentSummary[] }) {
  const signedDefault = docs.find((d) => ['signed', 'agreed'].includes(d.negotiationStatus));
  const proposedDefault = docs.find((d) => d.id !== signedDefault?.id && d.role === 'proposal') ?? docs.find((d) => d.id !== signedDefault?.id);
  const [a, setA] = useState(proposedDefault?.id ?? '');
  const [b, setB] = useState(signedDefault?.id ?? '');
  const res = useApi<ProposedSignedResponse>(a && b && a !== b ? `/proposed-vs-signed?a=${a}&b=${b}` : null);
  const [showSame, setShowSame] = useState(false);
  const rows = useMemo(() => res.data?.rows.filter((r) => showSame || r.status !== 'same') ?? [], [res.data, showSame]);

  return (
    <>
      <div className="card picker">
        <DocSelect label="Proposed" docs={docs} value={a} onChange={setA} />
        <DocSelect label="Signed" docs={docs} value={b} onChange={setB} />
      </div>
      <p className="muted small">Which side counts as agreed comes only from the status you set on the project page.</p>
      {res.error && <Warning tone="danger">{res.error}</Warning>}
      {res.data && (
        <>
          {res.data.warnings.map((w) => <Warning key={w}>{w}</Warning>)}
          <PartyWarnings changes={res.data.partyChanges} />
          <label className="toggle"><input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> Show clauses that are the same</label>
          <div className="cmp cmp--ps">
            <div className="cmp__head">
              <span>Proposed wording (not agreed) · {res.data.proposed.title}</span>
              <span>Agreed wording ({NEGOTIATION_LABELS[res.data.agreed.negotiationStatus].toLowerCase()}) · {res.data.agreed.title}</span>
            </div>
            {rows.length === 0 && <p className="muted">No differences.</p>}
            {rows.map((r, i) => (
              <div key={i} className={`cmp__row cmp__row--${r.status}`}>
                <div className="cmp__status"><span className={`chip chip--ps-${r.status}`}>{PS_LABELS[r.status]}</span></div>
                <div className="cmp__cell cmp__cell--proposed">{r.proposed ? <><Num n={r.proposed.clauseNumber} />{r.proposed.text}</> : <span className="muted">Not in the proposal</span>}</div>
                <div className="cmp__cell cmp__cell--agreed">{r.agreed ? <><Num n={r.agreed.clauseNumber} />{r.agreed.text}</> : <span className="muted">Not agreed: not in the signed version</span>}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---------- Letters ----------

function LettersMode({ docs }: { docs: DocumentSummary[] }) {
  const letters = docs.filter((d) => ['increase_letter', 'other'].includes(d.role));
  if (!letters.length) return <div className="card empty"><p>No letters in this project. Upload one with the role "Increase letter".</p></div>;
  return <>{letters.map((l) => <LetterCard key={l.id} letter={l} />)}</>;
}

function LetterCard({ letter }: { letter: DocumentSummary }) {
  const res = useApi<LetterMatchResponse>(`/documents/${letter.id}/letter-match`);
  const m = res.data;
  return (
    <div className="card letter">
      <div className="row-between">
        <strong>{letter.title}</strong>
        {m && <span className={`chip chip--match-${m.status}`}>{m.status === 'matched' ? 'Matched' : m.status === 'uncertain' ? 'Check this match' : 'Not matched'}</span>}
      </div>
      {res.error && <p className="error">{res.error}</p>}
      {m?.agreement && (
        <p>
          About <Link to={`/projects/${letter.projectId}/documents/${m.agreement.documentId}${m.clause ? `?block=${m.clause.blockId}` : ''}`}>
            {m.clause?.clauseNumber ? `clause ${m.clause.clauseNumber} of ` : ''}{m.agreement.title}
          </Link>
          {m.clause && <span className="muted">: “{m.clause.excerpt}”</span>}
        </p>
      )}
      {m && m.reasons.length > 0 && <ul className="small">{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {m && m.problems.map((p) => <Warning key={p}>{p}</Warning>)}
    </div>
  );
}
