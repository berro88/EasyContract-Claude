import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  DOCUMENT_ROLE_LABELS, SEVERITIES, SEVERITY_LABELS, TOPIC_LABELS, type BlockNote, type ClauseExplanation, type DocumentRole,
  DECISION_LABELS, type DocumentSummary, type DocumentVersionSummary, type ExtractionBlock, type FindingsResponse, type Role, type TopicsResponse,
} from '@easycontract/shared';
import { useApi } from '../lib/useApi.ts';
import { download } from '../lib/api.ts';
import { DecisionControls } from '../components/DecisionControls.tsx';
import { usePrefs } from '../lib/prefs.tsx';
import { Warning } from '../components/Warning.tsx';
import { POLICY_DISCLAIMER, WARNINGS } from '../lib/warnings.ts';

interface DocumentDetail { id: string; title: string; role: DocumentRole; versions: DocumentVersionSummary[] }
interface BlockDetail { block: ExtractionBlock; note: BlockNote; heading: string | null; explanations: ClauseExplanation[]; disclaimer: string }
interface Passage { text: string | null; verified: boolean; location: string; before: string; after: string }
type View = 'document' | 'topics' | 'findings';

const SAFETY_LINE = /^(Warning:|Tracked changes|Unaccepted revision)/;
const isTracked = (b: { kind: string }) => b.kind === 'tracked_insertion' || b.kind === 'tracked_deletion';

export function DocumentViewer() {
  const { projectId, documentId } = useParams();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('block');
  const view: View = params.get('view') === 'topics' ? 'topics' : params.get('view') === 'findings' ? 'findings' : 'document';
  const doc = useApi<DocumentDetail>(`/documents/${documentId}`);
  const project = useApi<{ documents: DocumentSummary[]; role: Role }>(`/projects/${projectId}`);
  const blocks = useApi<{ version: DocumentVersionSummary; blocks: ExtractionBlock[] }>(`/documents/${documentId}/blocks`);
  const topics = useApi<TopicsResponse>(`/documents/${documentId}/topics`);
  const readable = blocks.data?.version.status === 'ready';
  const findings = useApi<FindingsResponse>(readable ? `/documents/${documentId}/findings` : null);

  const go = (next: { view?: View; block?: string | null }) => {
    const p: Record<string, string> = {};
    const v = next.view ?? view;
    if (v !== 'document') p.view = v;
    const b = next.block === undefined ? selectedId : next.block;
    if (b) p.block = b;
    setParams(p);
  };

  if (doc.error || blocks.error) return <div className="card">{doc.error ?? blocks.error}</div>;
  if (!doc.data || !blocks.data) return null;
  const version = blocks.data.version;

  return (
    <section className="viewer">
      <div className="viewer__head">
        <Link to={`/projects/${projectId}`} className="back">← Project</Link>
        <h1>{doc.data.title}</h1>
        <p className="muted">
          {DOCUMENT_ROLE_LABELS[doc.data.role]} · {version.fileName} · version {version.versionNumber} · {blocks.data.blocks.length} passages
        </p>
      </div>

      {version.status === 'unreadable' && <Warning tone="danger">{version.qualityMessage ?? WARNINGS.unreadable}</Warning>}

      <div className="viewer__grid">
        <nav className="sidenav" aria-label="Sections">
          <button className={view === 'document' ? 'is-active' : ''} onClick={() => go({ view: 'document' })}>
            <span>Documents</span>
          </button>
          <ul className="sidenav__docs">
            {project.data?.documents.map((d) => (
              <li key={d.id}>
                <Link to={`/projects/${projectId}/documents/${d.id}`} className={d.id === documentId ? 'is-current' : ''}>
                  {d.title}
                  <small>{DOCUMENT_ROLE_LABELS[d.role]}</small>
                </Link>
              </li>
            ))}
          </ul>
          <button className={view === 'topics' ? 'is-active' : ''} onClick={() => go({ view: 'topics' })}>
            <span>Topics</span>
            {topics.data && <span className="count">{topics.data.cards.length}</span>}
          </button>
          <button className={view === 'findings' ? 'is-active' : ''} onClick={() => go({ view: 'findings' })}>
            <span>Findings</span>
            {findings.data && (findings.data.summary.red > 0
              ? <span className="count count--red" title="High concern">{findings.data.summary.red}</span>
              : findings.data.summary.amber > 0 && <span className="count count--amber" title="Check this">{findings.data.summary.amber}</span>)}
          </button>
          <Link className="sidenav__link" to={`/projects/${projectId}/compare`}>Compare →</Link>
        </nav>

        <div className="viewer__main">
          {view === 'document' && <DocumentText blocks={blocks.data.blocks} selectedId={selectedId} onSelect={(id) => go({ block: id })} />}
          {view === 'topics' && <TopicCards data={topics.data} error={topics.error} selectedId={selectedId} onSelect={(id) => go({ block: id })} />}
          {view === 'findings' && (
            <FindingsList
              documentId={documentId!}
              data={findings.data}
              error={findings.error}
              selectedId={selectedId}
              canDecide={!!project.data && ['owner', 'admin', 'reviewer'].includes(project.data.role)}
              onSelect={(id) => go({ block: id })}
              onChanged={findings.reload}
            />
          )}
        </div>

        <aside className="viewer__panel" aria-label="Explanation">
          {selectedId
            ? <BlockPanel blockId={selectedId} showOpenInDocument={view !== 'document'} onOpenInDocument={() => go({ view: 'document' })} />
            : (
              <div className="empty">
                <span className="empty__icon" aria-hidden>👈</span>
                <p>Click any passage to see what it means and exactly where it comes from.</p>
              </div>
            )}
        </aside>
      </div>
    </section>
  );
}

function DocumentText({ blocks, selectedId, onSelect }: { blocks: ExtractionBlock[]; selectedId: string | null; onSelect(id: string): void }) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);
  let lastPage = 0;
  return (
    <div className="viewer__doc" aria-label="Document">
      {blocks.map((b) => {
        const page = b.anchor.format === 'pdf' ? b.anchor.page : 0;
        const pageBreak = page && page !== lastPage ? <div className="page-sep">Page {page}</div> : null;
        lastPage = page || lastPage;
        const selected = b.id === selectedId;
        return (
          <div key={b.id}>
            {pageBreak}
            <button
              ref={selected ? selectedRef : undefined}
              className={['block', `block--${b.kind}`, selected ? 'is-selected' : '', b.flags.length ? 'is-flagged' : ''].join(' ')}
              onClick={() => onSelect(b.id)}
              aria-pressed={selected}
            >
              {b.clauseNumber && <span className="block__num">{b.clauseNumber}</span>}
              {isTracked(b) && <span className="block__tag">{b.kind === 'tracked_insertion' ? 'Added' : 'Deleted'}</span>}
              {b.flags.includes('embedded_instruction') && <span className="block__tag block__tag--bad">Check this</span>}
              <span className="block__text">{b.text}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TopicCards({ data, error, selectedId, onSelect }: {
  data: TopicsResponse | null; error: string | null; selectedId: string | null; onSelect(id: string): void;
}) {
  if (error) return <p className="error">{error}</p>;
  if (!data) return null;
  return (
    <div>
      {data.cards.length === 0 && <div className="card empty"><p>No clauses in this document matched any topic.</p></div>}
      <div className="topic-grid">
        {data.cards.map((card) => (
          <section key={card.topic} className="topic-card">
            <header>
              <h3>{card.label}</h3>
              <span className="count">{card.blocks.length}</span>
            </header>
            <ul>
              {card.blocks.map((b) => (
                <li key={b.blockId}>
                  <button className={`topic-ref ${b.blockId === selectedId ? 'is-selected' : ''}`} onClick={() => onSelect(b.blockId)}>
                    {b.clauseNumber && <span className="block__num">{b.clauseNumber}</span>}
                    {isTracked(b) && <span className="block__tag">{b.kind === 'tracked_insertion' ? 'Added' : 'Deleted'}</span>}
                    <span>{b.excerpt}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {data.notFound.length > 0 && (
        <section className="card not-found">
          <h3>Not stated in this document</h3>
          <p className="muted small">No clause matched these topics. That may be fine, or it may be a gap worth asking about. They might also be in another document in this project.</p>
          <div className="chips">
            {data.notFound.map((t) => <span key={t} className="chip">{TOPIC_LABELS[t]}</span>)}
          </div>
        </section>
      )}

      {data.unsorted.length > 0 && (
        <details className="card unsorted">
          <summary>{data.unsorted.length} passage{data.unsorted.length === 1 ? '' : 's'} not sorted into a topic</summary>
          <ul>
            {data.unsorted.map((b) => (
              <li key={b.blockId}>
                <button className={`topic-ref ${b.blockId === selectedId ? 'is-selected' : ''}`} onClick={() => onSelect(b.blockId)}>
                  {b.clauseNumber && <span className="block__num">{b.clauseNumber}</span>}
                  <span>{b.excerpt}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ExportButtons({ documentId }: { documentId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const get = async (format: 'docx' | 'pdf' | 'xlsx') => {
    setBusy(format);
    setError(null);
    try { await download(`/documents/${documentId}/report?format=${format}`); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className="exports">
      <span className="muted small">Download report:</span>
      <button className="btn btn--small" disabled={!!busy} onClick={() => get('docx')}>{busy === 'docx' ? 'Preparing…' : 'Word'}</button>
      <button className="btn btn--small" disabled={!!busy} onClick={() => get('pdf')}>{busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
      <button className="btn btn--small" disabled={!!busy} onClick={() => get('xlsx')}>{busy === 'xlsx' ? 'Preparing…' : 'Excel'}</button>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

function FindingsList({ documentId, data, error, selectedId, canDecide, onSelect, onChanged }: {
  documentId: string; data: FindingsResponse | null; error: string | null; selectedId: string | null; canDecide: boolean;
  onSelect(id: string): void; onChanged(): void;
}) {
  const { level } = usePrefs();
  if (error) return <Warning tone="danger">{error}</Warning>;
  if (!data) return <p className="muted">Checking the document…</p>;
  const decided = data.findings.filter((f) => f.decision?.decision).length;
  return (
    <div>
      <div className="sev-summary">
        {SEVERITIES.map((s) => (
          <span key={s} className={`sev sev--${s}`}><strong>{data.summary[s]}</strong> {SEVERITY_LABELS[s].toLowerCase()}</span>
        ))}
        <span className="muted small">{decided} of {data.findings.length} decided</span>
      </div>
      <ExportButtons documentId={documentId} />
      {data.findings.length === 0 && <div className="card empty"><p>None of the checks below found anything in this document.</p></div>}
      {data.findings.map((f) => (
        <article key={f.id} className={`finding finding--${f.severity}`}>
          <header>
            <span className={`sev sev--${f.severity}`}>{SEVERITY_LABELS[f.severity]}</span>
            <h3>{f.title}</h3>
          </header>
          <p>{level === 'legal' ? f.legal : f.plain}</p>
          {f.reference && (
            <div className="finding__ref"><span className="muted small">{f.reference.label}</span><q>{f.reference.text}</q></div>
          )}
          {f.cannotWorkOut && <p className="finding__cannot"><strong>Can't be worked out:</strong> {f.cannotWorkOut}</p>}
          {f.passages.length > 0 && (
            <ul className="finding__passages">
              {f.passages.map((p) => (
                <li key={p.blockId}>
                  <button className={`topic-ref ${p.blockId === selectedId ? 'is-selected' : ''}`} onClick={() => onSelect(p.blockId)}>
                    {p.clauseNumber && <span className="block__num">{p.clauseNumber}</span>}
                    {p.role === 'related' && <span className="block__tag">Related</span>}
                    <span>{p.excerpt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {f.passages.length === 0 && <p className="muted small">Not stated anywhere in this document.</p>}
          <DecisionControls documentId={documentId} finding={f} canDecide={canDecide} onSaved={onChanged} />
        </article>
      ))}
      {data.orphanedDecisions.length > 0 && (
        <section className="card">
          <h3>Decisions on findings that no longer appear</h3>
          <p className="muted small">The wording these findings were about has changed, so the checks no longer raise them. Your decisions are kept here.</p>
          <ul>
            {data.orphanedDecisions.map((d) => (
              <li key={d.findingKey}><strong>{d.findingTitle}</strong>: {d.decision ? DECISION_LABELS[d.decision] : 'no decision'}{d.note ? `, "${d.note}"` : ''}</li>
            ))}
          </ul>
        </section>
      )}
      <details className="card checked">
        <summary>What we checked</summary>
        <ul>{data.rulesChecked.map((r) => <li key={r.rule}>{r.label}</li>)}</ul>
        <p className="muted small">These are automatic checks for common problems. Finding nothing doesn't mean the contract is safe.</p>
      </details>
    </div>
  );
}

function BlockPanel({ blockId, showOpenInDocument, onOpenInDocument }: { blockId: string; showOpenInDocument: boolean; onOpenInDocument(): void }) {
  const { level } = usePrefs();
  const detail = useApi<BlockDetail>(`/blocks/${blockId}?level=${level}`);
  const passage = useApi<Passage>(`/blocks/${blockId}/passage`);
  const top = useRef<HTMLHeadingElement>(null);

  // On narrow screens the panel sits below the list, so bring it into view.
  useEffect(() => {
    if (detail.data && window.matchMedia('(max-width: 860px)').matches) top.current?.scrollIntoView({ behavior: 'smooth' });
  }, [blockId, detail.data]);

  if (detail.error || passage.error) return <p className="error">{detail.error ?? passage.error}</p>;
  if (!detail.data) return <p className="muted">Loading…</p>;
  const { block, note, explanations, heading } = detail.data;

  return (
    <>
      <h2 ref={top}>{block.clauseNumber ? `Clause ${block.clauseNumber}` : 'Passage'}</h2>
      {heading && <p className="muted small">Under “{heading}”</p>}
      {block.flags.includes('embedded_instruction') && <Warning tone="danger">{WARNINGS.embeddedInstruction}</Warning>}
      {isTracked(block) && <Warning>{WARNINGS.trackedChange}</Warning>}

      {explanations.length === 0 && (
        <p className="muted">This passage wasn't sorted into a topic, so there is no explanation for it. Read it in full below.</p>
      )}
      {explanations.map((e) => (
        <section key={e.topic} className="explain">
          <span className="chip chip--topic">{TOPIC_LABELS[e.topic]}</span>
          <h3>What it means</h3>
          <p>{e.whatItMeans}</p>
          <h3>Who it favours</h3>
          <p>{e.whoItFavours}</p>
          <h3>What to check</h3>
          <ul>{e.whatToCheck.map((c) => <li key={c}>{c}</li>)}</ul>
          {e.facts.length > 0 && (
            <>
              <h3>Quoted from this clause</h3>
              <dl className="facts">
                {e.facts.map((f) => (
                  <div key={f.kind + f.quote}>
                    <dt>{f.label}</dt>
                    <dd><q>{f.quote}</q></dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {e.reasons && e.reasons.length > 0 && (
            <>
              <h3>Why it's in this topic</h3>
              <p className="muted small">Mentions {e.reasons.join('; ')}.</p>
            </>
          )}
        </section>
      ))}

      <h3>Exact passage from the original file</h3>
      {passage.loading && <p className="muted">Opening the original…</p>}
      {passage.data && (
        <>
          {!passage.data.verified && <Warning tone="danger">{WARNINGS.unverified}</Warning>}
          <blockquote className="passage">
            {passage.data.before && <span className="passage__ctx">…{passage.data.before}{'\n'}</span>}
            <mark>{passage.data.text}</mark>
            {passage.data.after && <span className="passage__ctx">{'\n'}{passage.data.after}…</span>}
          </blockquote>
          <p className="muted small">
            {level === 'legal' ? passage.data.location : passage.data.location.split(',')[0]}
            {passage.data.verified && ' · matches the original file'}
          </p>
        </>
      )}
      {showOpenInDocument && <button className="btn" onClick={onOpenInDocument}>Show in the document</button>}
      {level === 'legal' && (
        <ul className="note small muted">
          {note.lines.filter((l) => !SAFETY_LINE.test(l)).map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      <p className="disclaimer">{POLICY_DISCLAIMER}</p>
    </>
  );
}
