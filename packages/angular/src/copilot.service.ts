import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { Signal, WritableSignal } from '@angular/core';
import { createCopilotClient } from '@gixcopilot/client';
import type { CopilotClient } from '@gixcopilot/client';
import {
  clearCopilotParts,
  createChatStore,
  createContextMessageResolver,
  createCopilotParts,
  createToolManifestResolver,
  toGenerativeUIRequests,
} from '@gixcopilot/headless';
import type {
  AgentRunState,
  ApprovalState,
  ChatSnapshot,
  ChatStatus,
  ChatStore,
  CopilotMessage,
  CopilotParts,
  GenerativeUIRequestState,
  ToolCallState,
  WorkflowRunState,
} from '@gixcopilot/headless';
import { CopilotError, createRunId, createToolCallId } from '@gixcopilot/protocol';
import type { PublicCopilotError, Thread, ToolResult } from '@gixcopilot/protocol';
import { COPILOT_CONFIG } from './config.js';

/**
 * One copilot instance: the Angular face of the framework-independent chat store in
 * `@gixcopilot/headless` (the same store the React adapter uses). State is exposed as signals;
 * actions delegate to the store and client. Provided by `provideCopilot()`; destroyed with its
 * injector, which cancels any active run and releases every registration.
 */
@Injectable()
export class CopilotService {
  readonly client: CopilotClient;
  /** Framework-neutral registries (context, state, tools, generative UI). Advanced use. */
  readonly parts: CopilotParts;
  readonly serverActions: boolean;

  private readonly store: ChatStore;
  private readonly snapshot: WritableSignal<ChatSnapshot>;

  /** The complete immutable chat snapshot. */
  readonly state: Signal<ChatSnapshot>;
  readonly messages: Signal<readonly CopilotMessage[]>;
  readonly status: Signal<ChatStatus>;
  readonly error: Signal<PublicCopilotError | null>;
  readonly thread: Signal<Thread | null>;
  readonly toolCalls: Signal<readonly ToolCallState[]>;
  readonly approvals: Signal<readonly ApprovalState[]>;
  readonly pendingApprovals: Signal<readonly ApprovalState[]>;
  readonly agentRuns: Signal<readonly AgentRunState[]>;
  readonly workflowRuns: Signal<readonly WorkflowRunState[]>;
  /** True while a turn is being submitted, streamed or waiting for an approval. */
  readonly busy: Signal<boolean>;
  /** Model requests to render registered components (validated props only). */
  readonly generativeUiRequests: Signal<readonly GenerativeUIRequestState[]>;

  constructor() {
    const config = inject(COPILOT_CONFIG);
    if (config.client) {
      this.client = config.client;
    } else {
      if (!config.endpoint?.trim()) throw CopilotError.validation('provideCopilot requires an endpoint or a client.');
      const getHeaders = config.getHeaders;
      this.client = createCopilotClient({ baseUrl: config.endpoint, getHeaders: () => getHeaders?.() ?? {} });
    }
    this.serverActions = !(config.localToolExecution ?? false);
    this.parts = createCopilotParts(config.context);
    this.store = createChatStore(
      this.client,
      config.model,
      config.threadId,
      createContextMessageResolver(this.parts),
      createToolManifestResolver(this.parts),
      this.parts.toolRuntime,
    );

    const snapshot = signal<ChatSnapshot>(this.store.getSnapshot());
    this.snapshot = snapshot;
    this.state = snapshot.asReadonly();
    this.messages = computed(() => snapshot().messages);
    this.status = computed(() => snapshot().status);
    this.error = computed(() => snapshot().error);
    this.thread = computed(() => snapshot().thread);
    this.toolCalls = computed(() => snapshot().toolCalls);
    this.approvals = computed(() => snapshot().approvals);
    this.pendingApprovals = computed(() => snapshot().approvals.filter((approval) => approval.status === 'pending'));
    this.agentRuns = computed(() => snapshot().agentRuns);
    this.workflowRuns = computed(() => snapshot().workflowRuns);
    this.busy = computed(() => {
      const status = snapshot().status;
      return status === 'submitting' || status === 'streaming' || status === 'waiting_for_approval';
    });
    const registry = this.parts.generativeComponentRegistry;
    this.generativeUiRequests = computed(() => toGenerativeUIRequests(snapshot().toolCalls, registry));

    const unsubscribe = this.store.subscribe(() => this.snapshot.set(this.store.getSnapshot()));
    this.store.mount();
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.store.dispose();
      clearCopilotParts(this.parts);
    });
  }

  /** Sends a user turn. Returns false when blank, busy or destroyed (not a failure). */
  sendMessage(text: string): boolean {
    return this.store.access.sendMessage(text);
  }

  /** Cancels the active run, keeping partial text. */
  stop(): void {
    this.store.access.stop();
  }

  retry(): boolean {
    return this.store.access.retry();
  }

  regenerate(): boolean {
    return this.store.access.regenerate();
  }

  /** Cancels and resets local history; does not delete server data. */
  clear(): void {
    this.store.access.clear();
  }

  /** Records a human decision on a pending approval. The server authorizes the decider. */
  approveAction(approvalId: string, comment?: string): Promise<void> {
    return this.store.access.approveAction(approvalId, comment);
  }

  rejectAction(approvalId: string, comment?: string): Promise<void> {
    return this.store.access.rejectAction(approvalId, comment);
  }

  /**
   * Invokes a tool on behalf of the user (e.g. a button in a rendered component). With server
   * actions (the default) the server's Action Firewall decides; only `localToolExecution` runs
   * a registered frontend tool locally.
   */
  invokeTool(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<ToolResult> {
    if (this.serverActions) return this.store.access.invokeTool(name, args);
    return this.parts.toolRuntime.execute({
      toolCallId: createToolCallId(),
      name,
      arguments: args,
      context: { runId: createRunId(), signal: new AbortController().signal },
    });
  }
}
