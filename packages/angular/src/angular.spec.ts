import { ChangeDetectionStrategy, Component, EnvironmentInjector, Input, createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CopilotError, PROTOCOL_VERSION } from '@gixcopilot/protocol';
import type { CopilotEvent, CopilotEventBase, ToolResult } from '@gixcopilot/protocol';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import {
  CopilotChatComponent,
  CopilotService,
  injectCopilot,
  injectCopilotContext,
  injectCopilotState,
  injectFrontendTool,
  injectGenerativeComponent,
  provideCopilot,
} from './index.js';

/** Indexes a list, failing the test loudly instead of using a non-null assertion. */
function at<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`nothing at index ${index}`);
  return value;
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} missing`);
  return value;
}

type EventInput = { type: CopilotEvent['type'] } & Record<string, unknown>;

/** A scripted client: the test pushes protocol events into each run, like the React specs. */
function fixture() {
  const runs: { options: RunOptions; push: (event: EventInput) => void; end: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const submitted: { runId: string; toolCallId: string; result: ToolResult }[] = [];
  let sequence = 0;
  const client: CopilotClient = {
    run(options) {
      const queue: CopilotEvent[] = [];
      let wake = (): void => {};
      let ended = false;
      const index = runs.length;
      const cancel = vi.fn(() => {
        ended = true;
        wake();
      });
      runs.push({
        options,
        cancel,
        push: (event) => {
          const base: CopilotEventBase = {
            id: `event-${++sequence}`,
            runId: `run-${index}`,
            threadId: options.threadId ?? '',
            timestamp: '2026-09-27T00:00:00.000Z',
            protocolVersion: PROTOCOL_VERSION,
            sequence,
          };
          queue.push({ ...base, ...event } as CopilotEvent);
          wake();
        },
        end: () => {
          ended = true;
          wake();
        },
      });
      return {
        cancel,
        events: {
          async *[Symbol.asyncIterator]() {
            while (!ended || queue.length) {
              const next = queue.shift();
              if (next) yield next;
              else await new Promise<void>((resolve) => (wake = resolve));
            }
          },
        },
      };
    },
    submitToolResult: vi.fn((runId: string, toolCallId: string, result: ToolResult) => {
      submitted.push({ runId, toolCallId, result });
      return Promise.resolve(undefined);
    }),
    decideApproval: vi.fn(() => Promise.resolve(undefined)),
  };
  return { client, runs, submitted };
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function streamAnswer(push: (event: EventInput) => void, text: string): void {
  push({ type: 'run.started' });
  push({ type: 'message.started', messageId: 'assistant-1', role: 'assistant' });
  push({ type: 'message.delta', messageId: 'assistant-1', delta: text });
}

afterEach(() => TestBed.resetTestingModule());

describe('@gixcopilot/angular', () => {
  it('provideCopilot + injectCopilot give one service per injector, backed by the shared store', async () => {
    const { client, runs } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const copilot = TestBed.runInInjectionContext(() => injectCopilot());
    expect(copilot).toBe(TestBed.inject(CopilotService));
    expect(copilot.status()).toBe('idle');

    expect(copilot.sendMessage('Hello')).toBe(true);
    expect(copilot.sendMessage('   ')).toBe(false);
    await flush();
    expect(runs).toHaveLength(1);
    expect(copilot.messages()[0]?.role).toBe('user');

    streamAnswer(at(runs, 0).push, 'Hi there');
    await flush();
    expect(copilot.status()).toBe('streaming');
    expect(copilot.busy()).toBe(true);
    at(runs, 0).push({ type: 'message.end', messageId: 'assistant-1', content: [{ type: 'text', text: 'Hi there' }] });
    at(runs, 0).push({ type: 'run.completed', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, finishReason: 'stop' });
    at(runs, 0).end();
    await flush();
    expect(copilot.status()).toBe('completed');
    const assistant = copilot.messages()[1];
    expect(assistant?.content[0]).toEqual({ type: 'text', text: 'Hi there' });
  });

  it('requires an endpoint or a client', () => {
    TestBed.configureTestingModule({ providers: [provideCopilot({ endpoint: ' ' })] });
    expect(() => TestBed.inject(CopilotService)).toThrow(/endpoint or a client/);
  });

  it('stop() cancels the real client run and keeps partial text', async () => {
    const { client, runs } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const copilot = TestBed.inject(CopilotService);
    copilot.sendMessage('Long answer please');
    await flush();
    streamAnswer(at(runs, 0).push, 'Partial');
    await flush();
    copilot.stop();
    await flush();
    expect(at(runs, 0).cancel).toHaveBeenCalled();
    expect(copilot.status()).toBe('stopped');
    expect(copilot.messages()[1]?.status).toBe('stopped');
  });

  it('surfaces run errors and retries the same turn', async () => {
    const { client, runs } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const copilot = TestBed.inject(CopilotService);
    copilot.sendMessage('Hi');
    await flush();
    at(runs, 0).push({ type: 'run.started' });
    at(runs, 0).push({ type: 'run.failed', error: CopilotError.networkError('disconnected').toPublicJSON() });
    at(runs, 0).end();
    await flush();
    expect(copilot.status()).toBe('error');
    expect(copilot.error()?.code).toBe('NETWORK_ERROR');
    expect(copilot.retry()).toBe(true);
    await flush();
    expect(runs).toHaveLength(2);
    expect(at(runs, 1).options.messages?.at(-1)).toMatchObject({ role: 'user' });
  });

  it('registers context from a signal, keeps it current, and removes it on destroy', async () => {
    const { client, runs } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const copilot = TestBed.inject(CopilotService);
    const page = signal({ route: '/applications/APP-1' });
    const child = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    runInInjectionContext(child, () => injectCopilotContext({ id: 'page', name: 'Current page', value: page }));
    TestBed.tick();
    expect(copilot.parts.registry.get('page')?.value).toEqual({ route: '/applications/APP-1' });

    page.set({ route: '/applications/APP-2' });
    TestBed.tick();
    expect(copilot.parts.registry.get('page')?.value).toEqual({ route: '/applications/APP-2' });

    copilot.sendMessage('Where am I?');
    await flush();
    expect(JSON.stringify(at(runs, 0).options.messages)).toContain('APP-2');

    child.destroy();
    expect(copilot.parts.registry.get('page')).toBeUndefined();
  });

  it('frontend tools run through the canonical tool runtime (schema-validated) and report back', async () => {
    const { client, runs, submitted } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const copilot = TestBed.inject(CopilotService);
    const opened: string[] = [];
    const child = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    runInInjectionContext(child, () =>
      injectFrontendTool({
        name: 'navigation.openApplication',
        description: 'Open an application in the UI',
        input: z.object({ applicationId: z.string() }),
        execute: ({ applicationId }) => {
          opened.push(applicationId);
          return Promise.resolve({ opened: applicationId });
        },
      }),
    );

    copilot.sendMessage('Open APP-7');
    await flush();
    expect(at(runs, 0).options.tools?.map((tool) => tool.name)).toContain('navigation.openApplication');
    at(runs, 0).push({ type: 'run.started' });
    at(runs, 0).push({ type: 'tool.requested', toolCallId: 'call-1', name: 'navigation.openApplication', arguments: { applicationId: 'APP-7' }, source: 'frontend' });
    await flush();
    expect(opened).toEqual(['APP-7']);
    expect(submitted[0]?.result).toMatchObject({ status: 'success', data: { opened: 'APP-7' } });

    at(runs, 0).push({ type: 'tool.requested', toolCallId: 'call-2', name: 'navigation.openApplication', arguments: { applicationId: 42 }, source: 'frontend' });
    await flush();
    expect(opened).toEqual(['APP-7']);
    expect(submitted[1]?.result).toMatchObject({ status: 'error' });

    child.destroy();
    expect(copilot.parts.toolRegistry.get('navigation.openApplication')).toBeUndefined();
  });

  it('shared state is a signal over the same state store; model writes only via the validated patch tool', () => {
    const { client } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const copilot = TestBed.inject(CopilotService);
    const handle = TestBed.runInInjectionContext(() =>
      injectCopilotState({
        id: 'filters',
        name: 'Filters',
        initialValue: { status: 'open' },
        exposeToModel: true,
        modelWritable: true,
        validate: (value) => typeof value.status === 'string',
      }),
    );
    expect(handle.value()).toEqual({ status: 'open' });
    handle.set({ status: 'closed' });
    expect(handle.value()).toEqual({ status: 'closed' });
    expect(copilot.parts.stateStore.get('filters')).toEqual({ status: 'closed' });
    copilot.parts.stateStore.set('filters', { status: 'review' });
    expect(handle.value()).toEqual({ status: 'review' });
    expect(copilot.parts.toolRegistry.list().some((tool) => tool.name.includes('state'))).toBe(true);
    TestBed.tick();
    expect(copilot.parts.registry.get('filters::state-context')?.value).toEqual({ status: 'review' });
  });

  it('renders only registered, schema-valid generative components', async () => {
    @Component({
      selector: 'test-status-card',
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `<p class="status-card">{{ applicationId }} is {{ status }}</p>`,
    })
    class StatusCardComponent {
      @Input({ required: true }) applicationId = '';
      @Input({ required: true }) status = '';
    }

    @Component({
      selector: 'test-host',
      imports: [CopilotChatComponent],
      template: `<aicopilot-chat label="Support copilot" />`,
    })
    class HostComponent {
      constructor() {
        injectGenerativeComponent({
          name: 'statusCard',
          description: 'Shows an application status',
          props: z.object({ applicationId: z.string(), status: z.string() }),
          component: StatusCardComponent,
        });
      }
    }

    const { client, runs, submitted } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const fixtureRef = TestBed.createComponent(HostComponent);
    await fixtureRef.whenStable();
    const copilot = TestBed.inject(CopilotService);
    const renderTool = copilot.parts.toolRegistry.list().find((tool) => tool.name.toLowerCase().includes('statuscard'));
    expect(renderTool).toBeDefined();

    copilot.sendMessage('Show status');
    await flush();
    at(runs, 0).push({ type: 'run.started' });
    at(runs, 0).push({ type: 'tool.requested', toolCallId: 'ui-1', name: required(renderTool, 'render tool').name, arguments: { applicationId: 'APP-9', status: 'approved' }, source: 'frontend' });
    at(runs, 0).push({ type: 'tool.requested', toolCallId: 'ui-2', name: required(renderTool, 'render tool').name, arguments: { applicationId: 'APP-9', status: 42 }, source: 'frontend' });
    at(runs, 0).push({ type: 'tool.requested', toolCallId: 'ui-3', name: 'ui.render.unregisteredWidget', arguments: { html: '<script>alert(1)</script>' }, source: 'frontend' });
    await flush();
    // Like the server, echo each submitted frontend result back as a tool event.
    for (const { toolCallId, result } of submitted) {
      if (result.status === 'success') at(runs, 0).push({ type: 'tool.completed', toolCallId, result: result.data });
      else at(runs, 0).push({ type: 'tool.failed', toolCallId, error: result.error });
    }
    await flush();
    expect(submitted.map((entry) => [entry.toolCallId, entry.result.status]).sort()).toEqual([
      ['ui-1', 'success'],
      ['ui-2', 'error'],
      ['ui-3', 'error'],
    ]);
    await fixtureRef.whenStable();
    const cards = (fixtureRef.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.status-card');
    expect(cards).toHaveLength(1);
    expect(at(cards, 0).textContent).toContain('APP-9 is approved');
    expect((fixtureRef.nativeElement as HTMLElement).innerHTML).not.toContain('<script>');
  });

  it('chat component is accessible, escapes text, and sends/stops from the keyboard-reachable controls', async () => {
    const { client, runs } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const fixtureRef = TestBed.createComponent(CopilotChatComponent);
    fixtureRef.componentRef.setInput('direction', 'rtl');
    await fixtureRef.whenStable();
    const root = fixtureRef.nativeElement as HTMLElement;
    const log = required(root.querySelector('[role="log"]'), 'log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(root.getAttribute('dir')).toBe('rtl');
    const textarea = required(root.querySelector('textarea'), 'textarea');
    expect(root.querySelector(`label[for="${textarea.id}"]`)?.textContent).toBe('Message');

    textarea.value = '<img src=x onerror=alert(1)>';
    required(root.querySelector('form'), 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await fixtureRef.whenStable();
    expect(textarea.value).toBe('');
    expect(root.querySelector('img')).toBeNull();
    expect(log.textContent).toContain('<img src=x onerror=alert(1)>');

    streamAnswer(at(runs, 0).push, 'Working');
    await flush();
    await fixtureRef.whenStable();
    const stop = [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Stop');
    expect(stop).toBeDefined();
    required(stop, 'stop button').click();
    await flush();
    expect(at(runs, 0).cancel).toHaveBeenCalled();
  });

  it('destroying the injector cancels the active run and clears every registration', async () => {
    const { client, runs } = fixture();
    TestBed.configureTestingModule({ providers: [provideCopilot({ client })] });
    const copilot = TestBed.inject(CopilotService);
    TestBed.runInInjectionContext(() => injectCopilotContext({ id: 'ctx', name: 'Ctx', value: 1 }));
    copilot.sendMessage('Hi');
    await flush();
    TestBed.resetTestingModule();
    expect(at(runs, 0).cancel).toHaveBeenCalled();
    expect(copilot.parts.registry.list()).toHaveLength(0);
    expect(copilot.sendMessage('after destroy')).toBe(false);
  });

  it('is SSR-safe: importing and providing touches no browser globals', async () => {
    const { client } = fixture();
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    try {
      const module = await import('./index.js');
      const injector = createEnvironmentInjector(module.provideCopilot({ client }), TestBed.inject(EnvironmentInjector));
      expect(injector.get(module.CopilotService).status()).toBe('idle');
      injector.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
