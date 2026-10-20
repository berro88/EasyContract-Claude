import { useRef, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  DOCUMENT_ROLES, DOCUMENT_ROLE_LABELS, NEGOTIATION_LABELS, NEGOTIATION_STATUSES, UPLOAD_LIMITS,
  type DocumentRole, type DocumentSummary, type NegotiationStatus, type ProjectSummary, type Role,
} from '@easycontract/shared';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { usePrefs } from '../lib/prefs.tsx';
import { Steps } from '../components/Steps.tsx';
import { Warning } from '../components/Warning.tsx';
import { WARNINGS } from '../lib/warnings.ts';

type ProjectDetail = ProjectSummary & { role: Role; documents: DocumentSummary[] };

const MAX_MB = UPLOAD_LIMITS.maxBytes / 1024 / 1024;

export function ProjectPage() {
  const { projectId } = useParams();
  const { t } = usePrefs();
  const { data, error, reload } = useApi<ProjectDetail>(`/projects/${projectId}`);
  const [role, setRole] = useState<DocumentRole>('main_agreement');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const [versionFor, setVersionFor] = useState<DocumentSummary | null>(null);

  async function update(path: string, body: unknown) {
    setMessage(null);
    try {
      await api(path, { method: 'PUT', body: JSON.stringify(body) });
      await reload();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  }

  async function send(file: File, newVersionOf: DocumentSummary | null = null) {
    setMessage(null);
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!(UPLOAD_LIMITS.extensions as readonly string[]).includes(ext)) {
      setMessage({ kind: 'error', text: 'Only PDF and Word (.docx or .doc) files are supported.' });
      return;
    }
    if (file.size > UPLOAD_LIMITS.maxBytes) {
      setMessage({ kind: 'error', text: `That file is too large. The limit is ${MAX_MB} MB.` });
      return;
    }
    const form = new FormData();
    // Fields before the file.
    form.append('role', newVersionOf?.role ?? role);
    if (newVersionOf) form.append('documentId', newVersionOf.id);
    form.append('file', file);
    setBusy(true);
    try {
      const res = await api<{ document: DocumentSummary; blockCount: number }>(`/projects/${projectId}/documents`, { method: 'POST', body: form });
      const v = res.document.latestVersion;
      setMessage(v?.status === 'unreadable'
        ? { kind: 'error', text: `${file.name}: ${v.qualityMessage}` }
        : { kind: 'ok', text: `${file.name} uploaded${newVersionOf ? ` as version ${v?.versionNumber} of "${newVersionOf.title}"` : ''}: ${res.blockCount} passages found.` });
      await reload();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      if (versionInput.current) versionInput.current.value = '';
      setVersionFor(null);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void send(f);
  }

  if (error) return <div className="card">{error}</div>;
  if (!data) return null;
  const canUpload = ['owner', 'admin', 'reviewer'].includes(data.role);
  const hasReady = data.documents.some((d) => d.latestVersion?.status === 'ready');

  return (
    <section>
      <Link to="/projects" className="back">← Projects</Link>
      <div className="card">
        <Steps current={hasReady ? 3 : 2} />
        <h1>{data.name}</h1>
        {data.description && <p className="muted">{data.description}</p>}

        {canUpload && (
          <div className="upload">
            <label className="field field--inline">
              <span>This document is a</span>
              <select value={role} onChange={(e) => setRole(e.target.value as DocumentRole)}>
                {DOCUMENT_ROLES.map((r) => <option key={r} value={r}>{DOCUMENT_ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            <button
              type="button"
              className={`dropzone ${dragging ? 'is-dragging' : ''}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              disabled={busy}
            >
              {busy ? 'Reading your document…' : t('uploadHint')}
              <small>PDF or Word (.docx or .doc), up to {MAX_MB} MB. Use synthetic or permitted documents only.</small>
            </button>
            <input ref={input} type="file" hidden accept=".pdf,.docx,.doc" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
            {message && (message.kind === 'ok'
              ? <p className="ok" role="status">{message.text}</p>
              : <Warning tone="danger">{message.text}</Warning>)}
          </div>
        )}
      </div>

      <div className="row-between">
        <h2>Documents</h2>
        {data.documents.filter((d) => d.latestVersion?.status === 'ready').length >= 2 && (
          <Link className="btn btn--primary" to={`/projects/${projectId}/compare`}>Compare and reconcile →</Link>
        )}
      </div>
      {data.documents.length === 0 && <div className="card empty"><p>No documents yet. Upload the main agreement first.</p></div>}
      <input ref={versionInput} type="file" hidden accept=".pdf,.docx,.doc" onChange={(e) => e.target.files?.[0] && send(e.target.files[0], versionFor)} />
      <ul className="list">
        {data.documents.map((d) => {
          const v = d.latestVersion;
          const unreadable = v?.status === 'unreadable';
          const linkable = ['amendment', 'addendum', 'increase_letter'].includes(d.role);
          const targets = data.documents.filter((t) => t.id !== d.id && ['main_agreement', 'signed_copy'].includes(t.role));
          return (
            <li key={d.id}>
              <div className="list__item doc-item">
                <div className="doc-item__main">
                  {unreadable ? <strong>{d.title}</strong> : <Link to={`/projects/${projectId}/documents/${d.id}`}><strong>{d.title}</strong></Link>}
                  <div className="muted">
                    {DOCUMENT_ROLE_LABELS[d.role]} · {v?.fileName} · version {v?.versionNumber}{d.versionCount > 1 ? ` of ${d.versionCount}` : ''}{v?.pageCount ? ` · ${v.pageCount} page${v.pageCount === 1 ? '' : 's'}` : ''}
                  </div>
                  {unreadable && <Warning tone="danger">{v?.qualityMessage ?? WARNINGS.unreadable}</Warning>}
                  <div className="doc-item__controls">
                    <label className="field field--inline field--small">
                      <span>Status</span>
                      <select
                        value={d.negotiationStatus}
                        disabled={!canUpload}
                        onChange={(e) => update(`/documents/${d.id}/status`, { negotiationStatus: e.target.value as NegotiationStatus })}
                      >
                        {NEGOTIATION_STATUSES.map((st) => <option key={st} value={st}>{NEGOTIATION_LABELS[st]}</option>)}
                      </select>
                    </label>
                    {d.statusSource === 'role' && <small className="muted">from the role you picked</small>}
                    {linkable && targets.length > 0 && (
                      <label className="field field--inline field--small">
                        <span>Applies to</span>
                        <select value={d.appliesTo ?? ''} disabled={!canUpload} onChange={(e) => update(`/documents/${d.id}/link`, { targetDocumentId: e.target.value || null })}>
                          <option value="">Any base agreement</option>
                          {targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                </div>
                <div className="doc-item__actions">
                  {!unreadable && <Link className="btn" to={`/projects/${projectId}/documents/${d.id}`}>Open</Link>}
                  {unreadable && <span className="badge badge--bad">Couldn't read</span>}
                  {canUpload && (
                    <button className="btn btn--quiet" disabled={busy} onClick={() => { setVersionFor(d); versionInput.current?.click(); }}>
                      New version
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        Status is only ever set by you. A file name or the word "final" never makes a document count as agreed.
      </p>
    </section>
  );
}
