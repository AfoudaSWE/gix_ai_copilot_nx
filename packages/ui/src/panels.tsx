import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { CopilotChat } from './components.js';
import type { CopilotChatProps } from './components.js';
import { DEFAULT_LABELS } from './labels.js';

/** Shared controlled/uncontrolled visibility and logical placement. */
export interface CopilotPanelProps extends CopilotChatProps {
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly placement?: 'start' | 'end';
}

function useOpen({ open, defaultOpen = false, onOpenChange }: CopilotPanelProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );
  return [open ?? internalOpen, setOpen] as const;
}

function containTab(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]',
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled, [hidden]') &&
      element.getClientRects().length > 0,
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Native modal dialog: browser focus containment, Escape, and explicit focus restoration. */
export function CopilotPopup(props: CopilotPanelProps): ReactElement {
  const [open, setOpen] = useOpen(props);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const previous = document.activeElement;
    element.showModal();
    element.querySelector('textarea')?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      else trigger.current?.focus();
    };
  }, [open]);
  return (
    <div className="gix-popup-root" dir={props.dir} data-placement={props.placement ?? 'end'}>
      <button
        ref={trigger}
        className="gix-launcher"
        type="button"
        aria-label={labels.open}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✳</span> {props.title ?? 'AI Copilot'}
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="gix-popup"
        aria-label={props.title ?? 'AI Copilot'}
        onKeyDown={containTab}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
      >
        {open ? (
          <CopilotChat
            {...props}
            headerActions={
              <>
                {props.headerActions}
                <button type="button" onClick={() => setOpen(false)} aria-label={labels.close}>
                  ×
                </button>
              </>
            }
          />
        ) : null}
      </dialog>
    </div>
  );
}

/** Nonmodal in-flow sidebar; host content remains keyboard-accessible. */
export function CopilotSidebar(props: CopilotPanelProps): ReactElement {
  const [open, setOpen] = useOpen({ defaultOpen: true, ...props });
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.querySelector('textarea')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      else trigger.current?.focus();
    };
  }, [open]);
  return (
    <div className="gix-sidebar-root" dir={props.dir} data-placement={props.placement ?? 'end'}>
      <button
        type="button"
        ref={trigger}
        className="gix-sidebar-toggle"
        aria-controls={id}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? labels.close : labels.open}
      </button>
      {open ? (
        <aside
          ref={panel}
          id={id}
          aria-label={props.title ?? 'AI Copilot'}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <CopilotChat
            {...props}
            headerActions={
              <>
                {props.headerActions}
                <button type="button" onClick={() => setOpen(false)} aria-label={labels.close}>
                  ×
                </button>
              </>
            }
          />
        </aside>
      ) : null}
    </div>
  );
}
