import { ChevronLeft, ChevronRight } from 'lucide-react';

import { adjacentMonth, monthLabel } from './month';

export function MonthNavigator({
  ariaLabel,
  month,
  onChange,
}: {
  ariaLabel: string;
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div aria-label={ariaLabel} className="month-navigator">
      <button
        aria-label="Previous month"
        onClick={() => onChange(adjacentMonth(month, -1))}
        title="Previous month"
        type="button"
      >
        <ChevronLeft aria-hidden="true" size={18} />
      </button>
      <strong aria-live="polite">{monthLabel(month)}</strong>
      <button
        aria-label="Next month"
        onClick={() => onChange(adjacentMonth(month, 1))}
        title="Next month"
        type="button"
      >
        <ChevronRight aria-hidden="true" size={18} />
      </button>
    </div>
  );
}
