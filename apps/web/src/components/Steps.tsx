/** The guided flow's progress indicator. */
export function Steps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Create a project', 'Upload documents', 'Read the contract'];
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={s} className={i + 1 === current ? 'is-current' : i + 1 < current ? 'is-done' : ''}>
          <span className="steps__n">{i + 1 < current ? '✓' : i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}
