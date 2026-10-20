import { Link } from 'react-router-dom';
import { POLICY_DISCLAIMER, WARNINGS } from '../lib/warnings.ts';

/** Shown on every page. Never themed, never dismissible. */
export function PolicyBanner() {
  return (
    <div className="policy-banner" role="note">
      <strong>{POLICY_DISCLAIMER}</strong>{' '}
      <span>{WARNINGS.draftPolicy}</span>{' '}
      <Link to="/policy">Read the usage policy</Link>
    </div>
  );
}
