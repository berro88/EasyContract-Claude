import { Link } from 'react-router-dom';
import { usePrefs } from '../lib/prefs.tsx';

export function CreateComingSoon() {
  const { t } = usePrefs();
  return (
    <section className="card empty">
      <span className="empty__icon" aria-hidden>🚧</span>
      <h1>{t('createTitle')}</h1>
      <p>{t('comingSoon')}</p>
      <p className="muted">
        You'll pick a contract type, answer plain-English questions (pre-filled from your company profile) and get an editable draft.
      </p>
      <Link to="/" className="btn">Back home</Link>
    </section>
  );
}
