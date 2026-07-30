import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { AuthBrand } from './Brand';
import { ThemeSelect } from './ThemeSelect';

export function AuthLayout({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="auth-layout">
      <div className="auth-layout__frame">
        <section className="auth-intro" aria-labelledby="auth-title">
          <AuthBrand />
          <p>{eyebrow}</p>
          <h1 id="auth-title">{title}</h1>
          <p className="auth-intro__description">{description}</p>
          <div className="auth-assurance">
            <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.7} />
            <span>
              <strong>Private by default</strong>
              <span>
                No public registration, analytics, or shared accounts.
              </span>
            </span>
          </div>
        </section>
        <section className="auth-workspace">
          <header className="auth-layout__header">
            <ThemeSelect />
          </header>
          <div className="auth-workspace__content">
            <section className="auth-card">{children}</section>
          </div>
        </section>
      </div>
    </main>
  );
}
