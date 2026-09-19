import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { CopilotProvider } from '@gixcopilot/react';
import type { CopilotAccess } from '@gixcopilot/react';
import { CopilotChat, CopilotPopup, CopilotSidebar, DEFAULT_LABELS, Markdown } from './index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeAll(() => {
  // jsdom has no modal top layer. Real focus containment is tested in Playwright.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

function fixture(failFirst = false) {
  let attempts = 0;
  const cancel = vi.fn();
  const client: CopilotAccess['client'] = {
    run(options) {
      attempts++;
      const attempt = attempts;
      const base = {
        protocolVersion: '1' as const,
        runId: `run-${attempt}`,
        threadId: options.threadId ?? '',
        timestamp: '2026-09-19T00:00:00.000Z',
      };
      return {
        cancel,
        events: {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve();
            yield { ...base, id: '1', sequence: 1, type: 'run.started' as const };
            yield {
              ...base,
              id: '2',
              sequence: 2,
              type: 'message.started' as const,
              messageId: `answer-${attempt}`,
              role: 'assistant' as const,
            };
            if (failFirst && attempt === 1) {
              yield {
                ...base,
                id: '3',
                sequence: 3,
                type: 'run.failed' as const,
                error: {
                  code: 'PROVIDER_ERROR' as const,
                  message: 'SECRET_INTERNAL_ERROR',
                  retryable: true,
                },
              };
            } else {
              yield {
                ...base,
                id: '3',
                sequence: 3,
                type: 'message.delta' as const,
                messageId: `answer-${attempt}`,
                delta: 'Hello **there**',
              };
              yield {
                ...base,
                id: '4',
                sequence: 4,
                type: 'message.end' as const,
                messageId: `answer-${attempt}`,
                content: [{ type: 'text' as const, text: 'Hello **there**' }],
              };
              yield {
                ...base,
                id: '5',
                sequence: 5,
                type: 'run.completed' as const,
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            }
          },
        },
      };
    },
  };
  return { client, cancel, attempts: () => attempts };
}

describe('composable Copilot UI', () => {
  it('renders empty state, suggestions, safe messages and regeneration', async () => {
    const f = fixture();
    render(
      <CopilotProvider client={f.client}>
        <CopilotChat suggestions={['Explain SSE']} />
      </CopilotProvider>,
    );
    expect(screen.getByText(DEFAULT_LABELS.emptyTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Explain SSE' }));
    await screen.findByRole('button', { name: 'Regenerate' });
    expect(screen.getByText('there').tagName).toBe('STRONG');
    expect(screen.getByRole('log').getAttribute('aria-live')).toBe('off');
    expect(screen.getByRole('status').textContent).toContain('Response complete');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(f.attempts()).toBe(2));
    await screen.findByRole('button', { name: 'Regenerate' });
    expect(screen.getAllByText('Explain SSE')).toHaveLength(1);
  });

  it('preserves input under composition, supports Shift+Enter and submits Enter', async () => {
    const f = fixture();
    render(
      <CopilotProvider client={f.client}>
        <CopilotChat />
      </CopilotProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'مرحبا' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true });
    expect(f.attempts()).toBe(0);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(f.attempts()).toBe(0);
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('مرحبا');
    expect(input.getAttribute('dir')).toBe('auto');
    expect((input as HTMLTextAreaElement).value).toBe('');
    await screen.findByRole('button', { name: 'Regenerate' });
  });

  it('shows safe errors and retries without duplicating the question', async () => {
    const f = fixture(true);
    render(
      <CopilotProvider client={f.client}>
        <CopilotChat suggestions={['Retry me']} />
      </CopilotProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry me' }));
    expect((await screen.findByRole('alert')).textContent).not.toContain('SECRET_INTERNAL_ERROR');
    expect(screen.getByText('Retry me')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Regenerate' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText('Retry me')).toHaveLength(1);
  });

  it('supports controlled popup visibility, Escape and focus restoration', () => {
    const f = fixture();
    function Controlled() {
      const [open, setOpen] = useState(false);
      return <CopilotPopup open={open} onOpenChange={setOpen} />;
    }
    render(
      <CopilotProvider client={f.client}>
        <Controlled />
      </CopilotProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Open copilot' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders a nonmodal RTL sidebar and localized controls', () => {
    const f = fixture();
    render(
      <CopilotProvider client={f.client}>
        <CopilotSidebar dir="rtl" theme="dark" labels={{ send: 'إرسال', input: 'رسالة' }} />
      </CopilotProvider>,
    );
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(screen.getByRole('button', { name: /إرسال/ })).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'رسالة' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open copilot' }));
    expect(screen.getByRole('complementary').querySelector('[dir=rtl]')).toBeTruthy();
  });

  it('contains a broken custom renderer and reports it to the host', async () => {
    const f = fixture();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken(): never {
      throw new Error('custom renderer failed');
    }
    render(
      <CopilotProvider client={f.client}>
        <p>Host survives</p>
        <CopilotChat
          suggestions={['Hi']}
          components={{ AssistantMessage: Broken }}
          onRenderError={onError}
        />
      </CopilotProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hi' }));
    await screen.findByText(DEFAULT_LABELS.renderError);
    expect(screen.getByText('Host survives')).toBeTruthy();
    expect(onError).toHaveBeenCalled();
  });

  it('passes automated accessibility checks for empty and completed chats', async () => {
    const f = fixture();
    const { container } = render(
      <CopilotProvider client={f.client}>
        <CopilotChat suggestions={['Check accessibility']} />
      </CopilotProvider>,
    );
    const options = { rules: { 'color-contrast': { enabled: false } } }; // Browser suite checks CSS/contrast.
    expect((await axe.run(container, options)).violations).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Check accessibility' }));
    await screen.findByRole('button', { name: 'Regenerate' });
    expect((await axe.run(container, options)).violations).toEqual([]);
  });
});

describe('untrusted Markdown', () => {
  it.each([
    '<script>window.compromised=true</script>',
    '<img src=x onerror="alert(1)">',
    '[unsafe](javascript:alert%281%29)',
    '[unsafe](data:text/html,evil)',
    '[unsafe](vbscript:msgbox)',
    '[unsafe](java&#x73;cript:alert%281%29)',
    '<iframe src="https://example.com"></iframe>',
    '![tracker](https://example.com/pixel)',
    '**malformed [text](<script>) `',
  ])('does not create active markup for %s', (content) => {
    const { container } = render(<Markdown content={content} />);
    expect(container.querySelector('script,img,iframe,object,embed')).toBeNull();
    for (const anchor of container.querySelectorAll('a'))
      expect(anchor.href).not.toMatch(/^(javascript|data|vbscript):/i);
  });

  it('renders GFM, safe external links and copyable literal code', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <Markdown
        content={
          '# Heading\n\n> Quote\n\n- Item\n\n[Docs](https://example.com)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\n<script>alert(1)</script>\n```'
        }
      />,
    );
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('<script>alert(1)</script>');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});
