import { useEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DOCUMENT_ROLE_LABELS, type BlockNote, type DocumentRole, type DocumentVersionSummary, type ExtractionBlock } from '@easycontract/shared';
import { useApi } from '../lib/useApi.ts';
import { usePrefs } from '../lib/prefs.tsx';
import { Warning } from '../components/Warning.tsx';
import { POLICY_DISCLAIMER, WARNINGS } from '../lib/warnings.ts';

interface DocumentDetail { id: string; title: string; role: DocumentRole; versions: DocumentVersionSummary[] }
interface BlockDetail { block: ExtractionBlock; note: BlockNote; disclaimer: string }
interface Passage { text: string | null; verified: boolean; location: string; before: string; after: string }

const SAFETY_LINE = /^(Warning:|Tracked changes|Unaccepted revision)/;
const isTracked =(b: ExtractionBlock) => b.kind === 'tracked_insertion' || b.kind === 'tracked_deletion';

export function DocumentViewer() {
  const { projectId, documentId } = useParams();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('block');
  const { level } = usePrefs();
  const doc = useApi<DocumentDetail>(`/documents/${documentId}`);
  const blocks = useApi<{ version: DocumentVersionSummary; blocks: ExtractionBlock[] }>(`/documents/${documentId}/blocks`);
  const detail = useApi<BlockDetail>(selectedId ? `/blocks/${selectedId}?level=${level}` : null);
  const passage = useApi<Passage>(selectedId ? `/blocks/${selectedId}/passage` : null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId, blocks.data]);

  if (doc.error || blocks.error) return <div className="card">{doc.error ?? blocks.error}</div>;
  if (!doc.data || !blocks.data) return null;

  const version = blocks.data.version;
  let lastPage = 0;

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
        <div className="viewer__doc" aria-label="Document">
          {blocks.data.blocks.map((b) => {
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
                  onClick={() => setParams({ block: b.id })}
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

        <aside className="viewer__panel" aria-label="Explanation">
          {!selectedId && (
            <div className="empty">
              <span className="empty__icon" aria-hidden>👈</span>
              <p>Click any passage to see exactly where it comes from.</p>
            </div>
          )}
          {selectedId && detail.data && (
            <>
              <h2>{detail.data.block.clauseNumber ? `Clause ${detail.data.block.clauseNumber}` : 'Passage'}</h2>
              {detail.data.block.flags.includes('embedded_instruction') && <Warning tone="danger">{WARNINGS.embeddedInstruction}</Warning>}
              {isTracked(detail.data.block) && <Warning>{WARNINGS.trackedChange}</Warning>}
              <ul className="note">
                {/* The warnings above already cover the provider's safety lines; show the rest. */}
                {detail.data.note.lines.filter((l) => !SAFETY_LINE.test(l)).map((l) => <li key={l}>{l}</li>)}
              </ul>

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
              <p className="disclaimer">{POLICY_DISCLAIMER}</p>
            </>
          )}
          {selectedId && (detail.error || passage.error) && <p className="error">{detail.error ?? passage.error}</p>}
        </aside>
      </div>
    </section>
  );
}
