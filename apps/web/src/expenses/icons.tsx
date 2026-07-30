import {
  Banknote,
  Car,
  CircleEllipsis,
  CreditCard,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Receipt,
  ShoppingBag,
  Smartphone,
  Ticket,
  Utensils,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  banknote: Banknote,
  car: Car,
  'circle-ellipsis': CircleEllipsis,
  'credit-card': CreditCard,
  'graduation-cap': GraduationCap,
  'heart-pulse': HeartPulse,
  house: House,
  landmark: Landmark,
  receipt: Receipt,
  'shopping-bag': ShoppingBag,
  smartphone: Smartphone,
  ticket: Ticket,
  utensils: Utensils,
  'wallet-cards': WalletCards,
};

export function ExpenseOptionIcon({
  name,
  size = 17,
}: {
  name: string;
  size?: number;
}) {
  const Icon = icons[name] ?? CircleEllipsis;
  return <Icon aria-hidden="true" size={size} strokeWidth={1.8} />;
}
