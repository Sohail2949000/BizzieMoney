import { Paperclip } from 'lucide-react';

export function AttachmentCount({ count }: { count: number }) {
  if (count <= 0) return null;

  const label = `${count} attachment${count === 1 ? '' : 's'}`;

  return (
    <small aria-label={label} className="attachment-count" title={label}>
      <Paperclip aria-hidden="true" size={12} />
      {count}
    </small>
  );
}
