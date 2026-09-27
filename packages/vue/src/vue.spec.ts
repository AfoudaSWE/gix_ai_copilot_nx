import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { z } from 'zod';
import { CopilotError, PROTOCOL_VERSION } from '@gixcopilot/protocol';
import type { CopilotEvent, CopilotEventBase, ToolResult } from '@gixcopilot/protocol';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import type { Copilot } from './index.js';
import { CopilotChat, createCopilot, createCopilotPlugin, provideCopilot, useCopilot, useCopilotContext, useFrontendTool } from './index.js';

function at<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`nothing at index ${index}`);
  return value;
}

type EventInput = { type: CopilotEvent['type'] } & Record<string, unknown>;

/** A scripted client: the test pushes protocol events into each run. */
function fixture() {
  const runs: { options: RunOptions; push: (event: EventInput) => void; end: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const submitted: { toolCallId: string; result: ToolResult }[] = [];
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
    submitToolResult: vi.fn((_runId: string, toolCallId: string, result: ToolResult) => {
      submitted.push({ toolCallId, result });
      return Promise.resolve(undefined);
    }),
    decideApproval: vi.fn(() => Promise.resolve(undefined)),
  };
  return { client, runs, submitted };
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

function answer(run: { push: (event: EventInput) => void; end: () => void }, text: string): void {
  run.push({ type: 'run.started' });
  run.push({ type: 'message.started', messageId: 'assistant-1', role: 'assistant' });
  run.push({ type: 'message.delta', messageId: 'assistant-1', delta: text });
  run.push({ type: 'message.end', messageId: 'assistant-1', content: [{ type: 'text', text }] });
  run.push({ type: 'run.completed', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, finishReason: 'stop' });
  run.end();
}

const mounted: App[] = [];
function mount(component: Parameters<typeof createApp>[0], install?: (app: App) => void): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  const app = createApp(component);
  install?.(app);
  app.mount(element);
  mounted.push(app);
  return element;
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  document.body.innerHTML = '';
});

describe('@gixcopilot/vue', () => {
  it('streams a turn through the shared headless store as reactive state', async () => {
    const { client, runs } = fixture();
    const copilot = createCopilot({ client });
    expect(copilot.status.value).toBe('idle');
    expect(copilot.sendMessage('Hello')).toBe(true);
    expect(copilot.sendMessage('   ')).toBe(false);
    await flush();
    answer(at(runs, 0), 'Hi there');
    await flush();
    expect(copilot.status.value).toBe('completed');
    expect(copilot.messages.value.map((message) => message.role)).toEqual(['user', 'assistant']);
    copilot.dispose();
  });

  it('requires an endpoint or a client, and useCopilot requires a provider', () => {
    expect(() => createCopilot({ endpoint: ' ' })).toThrow(/endpoint or a client/);
    const errors: unknown[] = [];
    mount(defineComponent({ setup: () => (useCopilot(), () => null) }), (app) => {
      app.config.errorHandler = (error) => void errors.push(error);
    });
    expect(String(errors[0])).toMatch(/No copilot provided/);
  });

  it('stop() cancels the client run; errors can be retried', async () => {
    const { client, runs } = fixture();
    const copilot = createCopilot({ client });
    copilot.sendMessage('Long answer');
    await flush();
    at(runs, 0).push({ type: 'run.started' });
    await flush();
    copilot.stop();
    await flush();
    expect(at(runs, 0).cancel).toHaveBeenCalled();
    expect(copilot.status.value).toBe('stopped');

    copilot.sendMessage('Again');
    await flush();
    at(runs, 1).push({ type: 'run.started' });
    at(runs, 1).push({ type: 'run.failed', error: CopilotError.networkError('disconnected').toPublicJSON() });
    at(runs, 1).end();
    await flush();
    expect(copilot.error.value?.code).toBe('NETWORK_ERROR');
    expect(copilot.retry()).toBe(true);
    await flush();
    expect(runs).toHaveLength(3);
    copilot.dispose();
  });

  it('the plugin provides one copilot; context follows a ref and is removed on unmount', async () => {
    const { client, runs } = fixture();
    let copilot: Copilot | undefined;
    const route = ref('/applications/APP-1');
    const show = ref(true);
    const Page = defineComponent({
      setup() {
        useCopilotContext({ id: 'page', name: 'Current page', value: route });
        return () => null;
      },
    });
    mount(
      defineComponent({
        setup() {
          copilot = useCopilot();
          return () => (show.value ? h(Page) : null);
        },
      }),
      (app) => app.use(createCopilotPlugin({ client })),
    );
    if (!copilot) throw new Error('copilot missing');
    expect(copilot.parts.registry.get('page')?.value).toBe('/applications/APP-1');
    route.value = '/applications/APP-2';
    await nextTick();
    expect(copilot.parts.registry.get('page')?.value).toBe('/applications/APP-2');

    copilot.sendMessage('Where am I?');
    await flush();
    expect(JSON.stringify(at(runs, 0).options.messages)).toContain('APP-2');

    show.value = false;
    await nextTick();
    expect(copilot.parts.registry.get('page')).toBeUndefined();
  });

  it('frontend tools run through the canonical tool runtime and report back', async () => {
    const { client, runs, submitted } = fixture();
    const opened: string[] = [];
    let copilot: Copilot | undefined;
    mount(
      defineComponent({
        setup() {
          copilot = provideCopilot({ client });
          useFrontendTool({
            name: 'navigation.openApplication',
            description: 'Open an application in the UI',
            input: z.object({ applicationId: z.string() }),
            execute: ({ applicationId }) => {
              opened.push(applicationId);
              return Promise.resolve({ opened: applicationId });
            },
          });
          return () => null;
        },
      }),
    );
    if (!copilot) throw new Error('copilot missing');
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
  });

  it('CopilotChat renders an accessible log, sends on Enter and escapes text', async () => {
    const { client, runs } = fixture();
    const element = mount(defineComponent({ setup: () => () => h(CopilotChat, { label: 'Support chat' }) }), (app) =>
      app.use(createCopilotPlugin({ client })),
    );
    const log = element.querySelector('[role="log"]');
    expect(log?.getAttribute('aria-label')).toBe('Support chat');
    expect(log?.getAttribute('aria-live')).toBe('polite');
    const textarea = element.querySelector('textarea');
    if (!textarea) throw new Error('textarea missing');
    expect(element.querySelector(`label[for="${textarea.id}"]`)?.textContent).toBe('Message');

    textarea.value = 'Hello';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();
    expect(runs).toHaveLength(1);
    expect(element.querySelector('button')?.textContent).toBe('Stop');

    answer(at(runs, 0), '<img src=x onerror=alert(1)>');
    await flush();
    expect(element.querySelector('img')).toBeNull();
    expect(log?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(element.querySelector('button')?.textContent).toBe('Send');
  });
});
