import { Link } from 'react-router-dom';
import { usePrefs } from '../lib/prefs.tsx';

export function Home() {
  const { t } = usePrefs();
  return (
    <section className="home">
      <h1>{t('homeTitle')}</h1>
      <p className="lead">{t('homeLead')}</p>
      <div className="choice-grid">
        <Link to="/projects/new" className="choice">
          <span className="choice__icon" aria-hidden>🔍</span>
          <h2>{t('understandTitle')}</h2>
          <p>{t('understandBody')}</p>
          <span className="choice__go">Start →</span>
        </Link>
        <Link to="/create" className="choice">
          <span className="choice__icon" aria-hidden>✍️</span>
          <h2>{t('createTitle')}</h2>
          <p>{t('createBody')}</p>
          <span className="choice__go">Coming soon</span>
        </Link>
      </div>
    </section>
  );
}
