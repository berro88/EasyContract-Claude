import type { ReactNode } from 'react';

/**
 * Safety messages. Styled with fixed colours outside the theme tokens so no
 * theme can tone them down.
 */
export function Warning({ children, tone = 'warn', title }: { children: ReactNode; tone?: 'warn' | 'danger'; title?: string }) {
  return (
    <div className={`safety safety--${tone}`} role={tone === 'danger' ? 'alert' : 'note'}>
      <span className="safety__icon" aria-hidden>!</span>
      <div>
        {title && <strong className="safety__title">{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}
