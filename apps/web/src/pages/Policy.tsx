import { useApi } from '../lib/useApi.ts';
import { Warning } from '../components/Warning.tsx';
import { WARNINGS } from '../lib/warnings.ts';

interface Policy { version: string; draft: boolean; title: string; disclaimer: string; sections: { heading: string; body: string }[] }

export function PolicyPage() {
  const { data } = useApi<Policy>('/policy');
  if (!data) return null;
  return (
    <article className="card prose">
      <h1>{data.title}</h1>
      <p className="muted">Version {data.version}</p>
      {data.draft && <Warning>{WARNINGS.draftPolicy}</Warning>}
      {data.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          <p>{s.body}</p>
        </section>
      ))}
    </article>
  );
}
