// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsDisclosure } from './SettingsDisclosure';

describe('SettingsDisclosure', () => {
  it('opens and closes from the summary activation', () => {
    const { container } = render(
      <SettingsDisclosure
        eyebrow="Attachments"
        icon={<span aria-hidden="true">Icon</span>}
        id="storage"
        title="File storage"
      >
        <p>Storage settings</p>
      </SettingsDisclosure>,
    );
    const details = container.querySelector('details');
    const summary = screen
      .getByRole('heading', {
        name: 'File storage',
      })
      .closest('summary');

    expect(details).not.toHaveAttribute('open');
    expect(summary).not.toBeNull();

    fireEvent.click(summary!);
    expect(details).toHaveAttribute('open');

    fireEvent.click(summary!);
    expect(details).not.toHaveAttribute('open');
  });

  it('honors an initially open disclosure', () => {
    const { container } = render(
      <SettingsDisclosure
        defaultOpen
        eyebrow="Data safety"
        icon={<span aria-hidden="true">Icon</span>}
        id="backups"
        title="Automatic backups"
      >
        <p>Backup settings</p>
      </SettingsDisclosure>,
    );

    expect(container.querySelector('details')).toHaveAttribute('open');
  });

  it('does not toggle when the optional heading action is used', () => {
    const action = vi.fn();
    const { container } = render(
      <SettingsDisclosure
        action={
          <button onClick={action} type="button">
            Edit
          </button>
        }
        defaultOpen
        eyebrow="General"
        icon={<span aria-hidden="true">Icon</span>}
        id="owner"
        title="Owner account"
      >
        <p>Account details</p>
      </SettingsDisclosure>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(action).toHaveBeenCalledOnce();
    expect(container.querySelector('details')).toHaveAttribute('open');
  });
});
