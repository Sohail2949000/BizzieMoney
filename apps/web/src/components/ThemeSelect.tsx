import { Monitor, Moon, SunMedium } from 'lucide-react';

import { useTheme } from '../theme/theme';

const themeOptions = [
  { icon: Monitor, label: 'System', value: 'system' },
  { icon: SunMedium, label: 'Light', value: 'light' },
  { icon: Moon, label: 'Dark', value: 'dark' },
] as const;

export function ThemeSelect() {
  const { preference, setPreference } = useTheme();

  return (
    <div aria-label="Appearance" className="theme-toggle" role="group">
      {themeOptions.map(({ icon: Icon, label, value }) => (
        <button
          aria-label={`Use ${label.toLowerCase()} appearance`}
          aria-pressed={preference === value}
          key={value}
          onClick={() => setPreference(value)}
          title={label}
          type="button"
        >
          <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
