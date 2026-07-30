import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function SettingsDisclosure({
  action,
  children,
  className,
  defaultOpen = false,
  eyebrow,
  icon,
  id,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  eyebrow: string;
  icon: ReactNode;
  id?: string;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = `${id ?? title.toLowerCase().replaceAll(/\s+/g, '-')}-title`;

  return (
    <details
      aria-labelledby={titleId}
      className={`settings-section settings-disclosure${className ? ` ${className}` : ''}`}
      id={id}
      open={open}
    >
      <summary
        className="settings-section__heading settings-disclosure__summary"
        onClick={(event) => {
          event.preventDefault();
          if ((event.target as HTMLElement).closest('button')) {
            return;
          }
          setOpen((currentOpen) => !currentOpen);
        }}
      >
        <span aria-hidden="true">{icon}</span>
        <div>
          <p>{eyebrow}</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        {action ? (
          <div className="settings-disclosure__action">{action}</div>
        ) : null}
        <span aria-hidden="true" className="settings-disclosure__chevron">
          <ChevronDown size={19} />
        </span>
      </summary>
      <div className="settings-disclosure__body">{children}</div>
    </details>
  );
}
