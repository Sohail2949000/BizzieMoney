import { Navigate, Route, Routes } from 'react-router-dom';

import { AuthBoundary } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { DebtsPage } from './pages/DebtsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';

export function App() {
  return (
    <AuthBoundary>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="debts" element={<DebtsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Route>
      </Routes>
    </AuthBoundary>
  );
}
