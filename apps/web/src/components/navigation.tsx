import {
  Clock3,
  DatabaseBackup,
  HandCoins,
  LayoutDashboard,
  ReceiptText,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';

import { navigationItems, type NavigationPath } from '@bizziemoney/shared';
import { backupApi } from '../api/backups';
import { usePreferences } from '../preferences/context';

const icons: Record<NavigationPath, LucideIcon> = {
  '/': LayoutDashboard,
  '/debts': HandCoins,
  '/expenses': ReceiptText,
  '/settings': Settings,
  '/subscriptions': Clock3,
};

const mobileLabels: Partial<Record<NavigationPath, string>> = {
  '/debts': 'Debts',
};

export function PrimaryNavigation() {
  return (
    <nav aria-label="Main navigation" className="primary-nav">
      <p className="primary-nav__label">Money</p>
      <div className="primary-nav__items">
        {navigationItems.map((item) => {
          const Icon = icons[item.path];
          return (
            <NavLink
              className={({ isActive }) =>
                `primary-nav__item${isActive ? ' is-active' : ''}`
              }
              end={item.path === '/'}
              key={item.path}
              to={item.path}
            >
              <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileNavigation() {
  return (
    <nav aria-label="Mobile navigation" className="mobile-nav">
      {navigationItems.map((item) => {
        const Icon = icons[item.path];
        return (
          <NavLink
            className={({ isActive }) =>
              `mobile-nav__item${isActive ? ' is-active' : ''}`
            }
            end={item.path === '/'}
            key={item.path}
            to={item.path}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
            <span>{mobileLabels[item.path] ?? item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function BackupStatusLink() {
  const { formatDateTime } = usePreferences();
  const statusQuery = useQuery({
    queryFn: backupApi.getStatus,
    queryKey: ['backup-status'],
    refetchInterval: 30_000,
  });
  const status = statusQuery.data;
  const title = status?.activeJob
    ? status.activeJob.kind === 'restore'
      ? 'Restore in progress'
      : 'Backup in progress'
    : status?.lastSuccessfulBackup
      ? 'Backups protected'
      : status?.config?.enabled
        ? 'Backup scheduled'
        : status?.configured
          ? 'Backups paused'
          : 'Backups not configured';
  const detail = status?.activeJob
    ? `${status.activeJob.progressStage} · ${status.activeJob.progressPercent}%`
    : status?.lastSuccessfulBackup
      ? formatDateTime(status.lastSuccessfulBackup.backupCreatedAt)
      : status?.config?.nextRunAt
        ? `Next ${formatDateTime(status.config.nextRunAt)}`
        : 'Choose a safe destination';
  const tone =
    status?.worker.status === 'offline'
      ? 'danger'
      : status?.lastSuccessfulBackup || status?.config?.enabled
        ? 'success'
        : 'warning';

  return (
    <NavLink className="backup-link" to="/settings#backups">
      <span aria-hidden="true" className="backup-link__icon">
        <DatabaseBackup size={17} strokeWidth={1.7} />
      </span>
      <span className="backup-link__copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span
        aria-hidden="true"
        className={`backup-link__status backup-link__status--${tone}`}
      />
    </NavLink>
  );
}
