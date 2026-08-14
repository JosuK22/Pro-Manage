import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Avatar from '../src/components/ui/Avatar/Avatar';
import Badge from '../src/components/ui/Badge/Badge';
import Modal from '../src/components/ui/Modal/Modal';
import PublicCard from '../src/pages/Public/PublicCard/PublicCard';

describe('Avatar', () => {
  it('shows the first two characters of an assignee email', () => {
    render(<Avatar email="mate@example.com" />);

    expect(screen.getByText('MA')).toBeInTheDocument();
  });

  // This is the regression that used to throw `Cannot read properties of null
  // (reading 'substring')` and blank the whole board.
  it.each([[null], [undefined], ['']])(
    'renders an Unassigned placeholder for %p instead of crashing',
    (value) => {
      render(<Avatar email={value} />);

      expect(screen.getByLabelText('Unassigned')).toBeInTheDocument();
    }
  );
});

describe('Badge', () => {
  it('renders a plain span when it is not interactive', () => {
    render(<Badge>Backlog</Badge>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a real button with an accessible name when clickable', async () => {
    const onClick = vi.fn();
    render(
      <Badge onClick={onClick} label="Move task to Done">
        Done
      </Badge>
    );

    const button = screen.getByRole('button', { name: 'Move task to Done' });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is reachable and activatable by keyboard', async () => {
    const onClick = vi.fn();
    render(
      <Badge onClick={onClick} label="Move task to Done">
        Done
      </Badge>
    );

    await userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Modal', () => {
  it('exposes a dialog role and an accessible name from its title', () => {
    render(
      <Modal toggleModal={() => {}} title="Delete task">
        <p>Body</p>
      </Modal>
    );

    expect(screen.getByRole('dialog', { name: 'Delete task' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape', async () => {
    const toggleModal = vi.fn();
    render(
      <Modal toggleModal={toggleModal} title="Delete task">
        <button type="button">Confirm</button>
      </Modal>
    );

    await userEvent.keyboard('{Escape}');

    expect(toggleModal).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog on open', () => {
    render(
      <Modal toggleModal={() => {}} title="Delete task">
        <button type="button">Confirm</button>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps Tab inside the dialog', async () => {
    render(
      <Modal toggleModal={() => {}} title="Delete task">
        <button type="button">Confirm</button>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');

    // Cycle past the end; focus must come back around, never escape to <body>.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes when the backdrop is clicked', async () => {
    const toggleModal = vi.fn();
    const { container } = render(
      <Modal toggleModal={toggleModal} title="Delete task">
        <p>Body</p>
      </Modal>
    );

    // The backdrop is aria-hidden, so query it structurally.
    const backdrop = document.querySelector('[aria-hidden="true"]');
    await userEvent.click(backdrop);

    expect(toggleModal).toHaveBeenCalled();
    expect(container).toBeDefined();
  });
});

describe('PublicCard', () => {
  const baseTask = {
    _id: 'task-1',
    title: 'Prepare project report',
    priority: 'high',
    status: 'todo',
    assignee: 'mate@example.com',
    dueDate: null,
    isExpired: false,
    checklists: [
      { _id: 'c1', title: 'Draft outline', checked: true },
      { _id: 'c2', title: 'Review with team', checked: false },
    ],
  };

  it('renders the task with its checklist progress', () => {
    render(<PublicCard task={baseTask} />);

    expect(
      screen.getByRole('heading', { name: 'Prepare project report' })
    ).toBeInTheDocument();
    expect(screen.getByText('Checklist (1/2)')).toBeInTheDocument();
  });

  it('renders an unassigned shared task without crashing', () => {
    render(<PublicCard task={{ ...baseTask, assignee: null }} />);

    expect(screen.getByLabelText('Unassigned')).toBeInTheDocument();
  });

  it('presents checklist items as read-only', () => {
    render(<PublicCard task={baseTask} />);

    const checkboxes = screen.getAllByRole('checkbox');

    expect(checkboxes).toHaveLength(2);
    checkboxes.forEach((checkbox) => expect(checkbox).toBeDisabled());
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('handles a task with no checklist items', () => {
    render(<PublicCard task={{ ...baseTask, checklists: [] }} />);

    expect(screen.getByText('Checklist (0/0)')).toBeInTheDocument();
    expect(screen.getByText(/no checklist items/i)).toBeInTheDocument();
  });

  it('labels each checklist item so the checkbox has an accessible name', () => {
    render(<PublicCard task={baseTask} />);

    const list = screen.getByRole('list');
    expect(within(list).getByRole('checkbox', { name: 'Draft outline' })).toBeInTheDocument();
  });
});
