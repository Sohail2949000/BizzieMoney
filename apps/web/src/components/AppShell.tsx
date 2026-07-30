import { Outlet, useLocation } from 'react-router-dom';

import { Brand } from './Brand';
import {
  BackupStatusLink,
  MobileNavigation,
  PrimaryNavigation,
} from './navigation';
import { OwnerMenu } from './OwnerMenu';
import { ThemeSelect } from './ThemeSelect';

const pageNames: Record<string, string> = {
  '/': 'Overview',
  '/debts': 'Loans & Debts',
  '/expenses': 'Expenses',
  '/settings': 'Settings',
  '/subscriptions': 'Subscriptions',
};

export function AppShell() {
  const location = useLocation();
  const pageName = pageNames[location.pathname] ?? 'Overview';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__top">
          <div className="sidebar__brand-zone">
            <Brand />
          </div>
          <PrimaryNavigation />
        </div>
        <div className="sidebar__bottom">
          <BackupStatusLink />
          <OwnerMenu />
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__mobile-brand">
            <Brand />
          </div>
          <p className="topbar__page-name">{pageName}</p>
          <ThemeSelect />
        </header>
        <main className="page" id="main-content">
          <Outlet />
        </main>
      </div>

      <MobileNavigation />
    </div>
  );
}
