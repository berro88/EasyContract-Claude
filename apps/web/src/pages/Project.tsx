import { useRef, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DOCUMENT_ROLES, DOCUMENT_ROLE_LABELS, UPLOAD_LIMITS, type DocumentRole, type DocumentSummary, type ProjectSummary, type Role } from '@easycontract/shared';
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

  async function send(file: File) {
    setMessage(null);
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!(UPLOAD_LIMITS.extensions as readonly string[]).includes(ext)) {
      setMessage({ kind: 'error', text: 'Only PDF and Word (.docx) files are supported.' });
      return;
    }
    if (file.size > UPLOAD_LIMITS.maxBytes) {
      setMessage({ kind: 'error', text: `That file is too large. The limit is ${MAX_MB} MB.` });
      return;
    }
    const form = new FormData();
    form.append('role', role); // fields before the file
    form.append('file', file);
    setBusy(true);
    try {
      const res = await api<{ document: DocumentSummary; blockCount: number }>(`/projects/${projectId}/documents`, { method: 'POST', body: form });
      const v = res.document.latestVersion;
      setMessage(v?.status === 'unreadable'
        ? { kind: 'error', text: `${file.name}: ${v.qualityMessage}` }
        : { kind: 'ok', text: `${file.name} uploaded: ${res.blockCount} passages found.` });
      await reload();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
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
              <small>PDF or .docx, up to {MAX_MB} MB. Use synthetic or permitted documents only.</small>
            </button>
            <input ref={input} type="file" hidden accept=".pdf,.docx" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
            {message && (message.kind === 'ok'
              ? <p className="ok" role="status">{message.text}</p>
              : <Warning tone="danger">{message.text}</Warning>)}
          </div>
        )}
      </div>

      <h2>Documents</h2>
      {data.documents.length === 0 && <div className="card empty"><p>No documents yet. Upload the main agreement first.</p></div>}
      <ul className="list">
        {data.documents.map((d) => {
          const v = d.latestVersion;
          const unreadable = v?.status === 'unreadable';
          return (
            <li key={d.id}>
              <div className="list__item">
                <div>
                  {unreadable ? <strong>{d.title}</strong> : <Link to={`/projects/${projectId}/documents/${d.id}`}><strong>{d.title}</strong></Link>}
                  <div className="muted">
                    {DOCUMENT_ROLE_LABELS[d.role]} · {v?.fileName} · version {v?.versionNumber}{v?.pageCount ? ` · ${v.pageCount} page${v.pageCount === 1 ? '' : 's'}` : ''}
                  </div>
                  {unreadable && <Warning tone="danger">{v?.qualityMessage ?? WARNINGS.unreadable}</Warning>}
                </div>
                {unreadable ? <span className="badge badge--bad">Couldn't read</span> : <Link className="btn" to={`/projects/${projectId}/documents/${d.id}`}>Open</Link>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
