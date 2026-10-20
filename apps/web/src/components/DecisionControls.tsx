import { useEffect, useState } from 'react';
import { DECISIONS, DECISION_LABELS, type Decision, type Finding } from '@easycontract/shared';
import { api } from '../lib/api.ts';
import { Warning } from './Warning.tsx';

/** Accept / reject / negotiate plus a note, saved against the finding. */
export function DecisionControls({ documentId, finding, canDecide, onSaved }: {
  documentId: string; finding: Finding; canDecide: boolean; onSaved(): void;
}) {
  const saved = finding.decision;
  const [decision, setDecision] = useState<Decision | null>(saved?.decision ?? null);
  const [note, setNote] = useState(saved?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDecision(saved?.decision ?? null); setNote(saved?.note ?? ''); }, [saved?.decision, saved?.note]);
  const dirty = decision !== (saved?.decision ?? null) || note.trim() !== (saved?.note ?? '');

  async function save(next: Decision | null = decision) {
    setBusy(true);
    setError(null);
    try {
      await api(`/documents/${documentId}/findings/${finding.key}/decision`, { method: 'PUT', body: JSON.stringify({ decision: next, note }) });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="decision">
      {saved?.wordingChanged && <Warning>The wording behind this finding has changed since the decision was made. Review it again and save.</Warning>}
      <div className="decision__row" role="group" aria-label="Decision">
        {DECISIONS.map((d) => (
          <button
            key={d}
            type="button"
            className={`decision__btn decision__btn--${d} ${decision === d ? 'is-active' : ''}`}
            aria-pressed={decision === d}
            disabled={!canDecide || busy}
            onClick={() => setDecision(decision === d ? null : d)}
          >
            {DECISION_LABELS[d]}
          </button>
        ))}
      </div>
      <textarea
        className="decision__note"
        placeholder={canDecide ? 'Add a note (optional)' : 'No note'}
        value={note}
        maxLength={2000}
        rows={2}
        disabled={!canDecide || busy}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="decision__foot">
        {saved && <span className="muted small">Saved by {saved.decidedBy} on {saved.decidedAt.slice(0, 10)}</span>}
        {canDecide && (dirty || saved?.wordingChanged) && (
          <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save decision'}</button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
