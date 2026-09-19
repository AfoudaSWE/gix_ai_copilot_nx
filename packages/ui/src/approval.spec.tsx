import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { ApprovalCard, SecurityDenial } from './index.js';
import type { ApprovalState } from '@gixcopilot/react';

afterEach(cleanup);
const approval: ApprovalState = { approvalId: 'a', toolCallId: 'c', action: 'records.delete',
  approvalLevel: 'admin', status: 'pending', summary: 'Delete APP-1024 permanently', risk: 'destructive', reversibility: 'irreversible',
  preview: { summary: 'Remove the record', changes: [{ field: 'record', before: 'present', after: 'deleted' }] } };

describe('approval UI', () => {
  it('announces the risk, focuses the safe choice and supports RTL without accessibility violations', async () => {
    const { container } = render(<div dir="rtl"><ApprovalCard approval={approval} onApprove={vi.fn()} onReject={vi.fn()} /></div>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByText(/destructive/)).toBeDefined();
    expect(screen.getByRole('alertdialog').getAttribute('aria-labelledby')).toBeTruthy();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('keeps rejected network decisions visible and allows retry without an unhandled rejection', async () => {
    const approve = vi.fn(() => Promise.reject(new Error('private policy detail')));
    render(<ApprovalCard approval={approval} onApprove={approve} onReject={vi.fn()} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be accepted'));
    expect(screen.queryByText('private policy detail')).toBeNull();
    const approveButton = screen.getByRole('button', { name: 'Approve' });
    expect(approveButton).toBeInstanceOf(HTMLButtonElement);
    if (approveButton instanceof HTMLButtonElement) {
      expect(approveButton.disabled).toBe(false);
    }
  });

  it('removes decisions for cancelled approvals and renders a safe denial', () => {
    render(<><ApprovalCard approval={{ ...approval, status: 'cancelled' }} onApprove={vi.fn()} onReject={vi.fn()} /><SecurityDenial message="You do not have permission." /></>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('You do not have permission');
  });
});
