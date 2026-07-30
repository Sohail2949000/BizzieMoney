import {
  Clock3,
  HandCoins,
  ReceiptText,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

type ModuleKind = 'expenses' | 'subscriptions' | 'debts' | 'settings';

const iconByKind: Record<ModuleKind, LucideIcon> = {
  debts: HandCoins,
  expenses: ReceiptText,
  settings: Settings,
  subscriptions: Clock3,
};

interface ModuleEmptyPageProps {
  actionLabel: string;
  description: string;
  kind: ModuleKind;
  title: string;
}

export function ModuleEmptyPage({
  actionLabel,
  description,
  kind,
  title,
}: ModuleEmptyPageProps) {
  const Icon = iconByKind[kind];

  return (
    <div className="module-page">
      <div className="page-heading">
        <div>
          <p className="page-heading__context">Your money</p>
          <h1>{title}</h1>
        </div>
      </div>

      <section aria-labelledby={`${kind}-empty-title`} className="empty-panel">
        <span aria-hidden="true" className="empty-panel__icon">
          <Icon size={24} strokeWidth={1.6} />
        </span>
        <p className="empty-panel__label">{actionLabel}</p>
        <h2 id={`${kind}-empty-title`}>Nothing to sort through yet.</h2>
        <p>{description}</p>
        <Link className="button button--secondary" to="/">
          Return to overview
        </Link>
      </section>
    </div>
  );
}
