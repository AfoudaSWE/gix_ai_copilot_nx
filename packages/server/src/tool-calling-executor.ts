import { randomUUID } from 'node:crypto';
import { CopilotError } from '@gixcopilot/protocol';
import type {
  ContentPart,
  ThreadId,
  ToolActionPreview,
  ToolApprovalLevel,
  ToolCall,
  ToolManifestEntry,
  ToolResult,
  ToolSecurityManifest,
} from '@gixcopilot/protocol';
import type { Executor, ExecutorContext, ExecutorInput } from '@gixcopilot/core';
import { createToolRuntime, runWithConcurrencyPlan, toToolManifest } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolResolver } from '@gixcopilot/tools';
import type { ModelMessage, ModelReference, ModelRuntime, ModelToolDefinition } from '@gixcopilot/provider';
import { createActionFirewallMiddleware, strongerApprovalLevel } from '@gixcopilot/security';
import type {
  ActionFirewall,
  ActionMetadata,
  ActionRequest,
  ApprovalStore,
  AuditRecord,
  DataPolicy,
  SecurityContext,
  SecurityReason,
} from '@gixcopilot/security';
import type { FrontendToolBridge } from './frontend-tool-bridge.js';

export interface CreateToolCallingExecutorOptions {
  readonly modelRuntime?: ModelRuntime;
  readonly action?: { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> };
  readonly frontendDefinitions?: readonly AnyToolDefinition[];
  readonly model?: ModelReference;
  /** Discovery boundary for backend tools (Section 65-66) - see `@gixcopilot/tools`. */
  readonly backendToolResolver: ToolResolver;
  /** Per-run, client-declared frontend tool manifest (Section 45-46) - wire-safe, no Zod
   * schemas (those never leave the browser). Empty when the client registered none. */
  readonly frontendTools: readonly ToolManifestEntry[];
  readonly frontendToolBridge: FrontendToolBridge;
  /** Hard cap on Model -> Tool -> Model rounds within a single run (Section 40). */
  readonly maxToolIterations?: number;
  /** How long the server waits for a frontend tool result before FRONTEND_TOOL_UNAVAILABLE
   * (Section 51). Omit for no timeout (bounded only by run cancellation). */
  readonly frontendToolTimeoutMs?: number;
  readonly toolTimeoutMs?: number;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  /**
   * Phase 7 (Section 70-72): when set, every tool call - backend, frontend, and Generative
   * UI/state-patch reserved calls alike, since all of them arrive as ordinary `ToolCall`s
   * here - is evaluated by the firewall before it executes. Omitted entirely, this server
   * behaves exactly as it did in Phase 5/6 (opt-in, not forced - see Phase_7_Decisions.md).
   */
  readonly actionFirewall?: ActionFirewall;
  /**
   * Unfiltered backend tool lookup, used only to read a tool's declared `security` metadata
   * for firewall evaluation (Section 21's defense in depth) - deliberately separate from
   * `backendToolResolver`, which is typically permission-filtered for model discovery
   * (Section 20). A tool hidden from discovery still has security metadata, and the firewall
   * must be able to see it to deny a manually-constructed call for that same tool; looking
   * it up from the already-filtered resolver would find nothing and silently skip
   * enforcement instead. Defaults to `backendToolResolver` when omitted.
   */
  readonly securityToolResolver?: ToolResolver;
  /** Required when `actionFirewall` is configured and any tool can require approval - a
   * firewall `'approval'` decision with no store configured is treated as a denial. */
  readonly approvals?: ApprovalStore;
  /** The trusted identity/tenant this run executes as (Section 11, 13) - built by the server
   * from its own `AuthenticationAdapter`, never from client/model-supplied fields. */
  readonly securityContext?: SecurityContext;
  /**
   * Re-resolves the security context at approval-revalidation time (Section 42, 44: "Do NOT
   * execute based only on the old authorization result. Re-evaluate current security
   * context"). Without this, revalidation reuses the same `securityContext` snapshot from
   * when the run started, which cannot observe a permission revoked *during* the (possibly
   * minutes-long) approval wait. A server wires this to re-invoke its own
   * `AuthenticationAdapter` - see `@gixcopilot/server`'s `app.ts`.
   */
  readonly refreshSecurityContext?: () => Promise<SecurityContext> | SecurityContext;
  /** Default approval expiration (Section 41). Omit for no expiration. */
  readonly approvalExpiresInMs?: number;
  /**
   * Applied to a backend tool's successful result before it becomes visible to the model or
   * the client (Section 56): "the tool may need the full data internally while the model
   * should see only a filtered version." Not applied to frontend tool results, which never
   * pass through the server at all.
   */
  readonly dataPolicy?: DataPolicy;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

function toModelToolDefinitions(
  manifest: readonly ToolManifestEntry[],
): readonly ModelToolDefinition[] {
  return manifest.map((entry) => ({
    name: entry.name,
    description: entry.description,
    parameters: entry.parameters,
  }));
}

function assistantToolCallMessage(toolCalls: readonly ToolCall[]): ModelMessage {
  const content: ContentPart[] = toolCalls.map((call) => ({
    type: 'tool_call',
    toolCallId: call.id,
    name: call.name,
    arguments: call.arguments,
  }));
  return { role: 'assistant', content };
}

function toolResultMessage(result: ToolResult): ModelMessage {
  return {
    role: 'tool',
    content: [{ type: 'tool_result', toolCallId: result.toolCallId, result }],
  };
}

function actionMetadataOf(
  toolName: string,
  source: 'frontend' | 'backend',
  security: ToolSecurityManifest | undefined,
): ActionMetadata {
  return {
    toolName,
    source,
    risk: security?.risk,
    reversibility: security?.reversibility,
    requiredPermissions: security?.requiredPermissions,
    approval: security?.approval,
    dataClassification: security?.dataClassification,
  };
}

function errorForDenial(reason: SecurityReason): CopilotError {
  return new CopilotError(reason.code, reason.message, { retryable: false });
}

function summaryFor(call: ToolCall): string {
  return `Call "${call.name}" with the provided arguments.`;
}

/**
 * Best-effort dry-run preview (Section 48-51) for a backend tool that declares one - never
 * lets a broken/throwing `dryRun` block the approval flow; a preview is a nice-to-have for
 * the approval UI, not a correctness requirement.
 */
async function tryDryRun(
  call: ToolCall,
  backendTools: readonly AnyToolDefinition[],
  runId: ExecutorContext['runId'],
  threadId: ThreadId | undefined,
  signal: AbortSignal,
  securityContext?: SecurityContext,
): Promise<ToolActionPreview | undefined> {
  const tool = backendTools.find((candidate) => candidate.name === call.name);
  if (!tool?.dryRun) return undefined;
  const parsed = tool.inputSchema.safeParse(call.arguments);
  if (!parsed.success) return undefined;
  try {
    return await tool.dryRun(parsed.data, { runId, threadId, signal, metadata: { securityContext } });
  } catch {
    return undefined;
  }
}

type DispatchPlan =
  | { readonly kind: 'proceed'; readonly call: ToolCall }
  | { readonly kind: 'denied'; readonly call: ToolCall; readonly result: ToolResult }
  | {
      readonly kind: 'awaiting-approval';
      readonly call: ToolCall;
      readonly approvalId: string;
      readonly request: ActionRequest;
      readonly preview?: ToolActionPreview;
    };

/**
 * The Model -> Tool -> Model loop (Section 39, 101), implemented as a single `Executor.execute()`
 * call - `@gixcopilot/core`'s runtime and protocol never need to know a tool-calling round
 * trip happened at all; they only see text deltas and, via `ExecutorContext.onToolEvent`
 * (Phase 5's additive extension point - see `@gixcopilot/core`'s executor.ts), tool
 * lifecycle notifications interleaved with them. Backend tool calls execute in-process via
 * `@gixcopilot/tools`' ToolRuntime; frontend tool calls suspend on `frontendToolBridge`
 * until the client posts a result back (Section 45) - see docs/phases/phase-05/
 * Phase_5_Architecture.md for the full diagram.
 *
 * Phase 7 inserts the Action Firewall as a mandatory pre-dispatch evaluation, in two passes
 * per batch (see Phase_7_Decisions.md's "why two passes"): pass 1 evaluates every call and
 * emits `tool.requested`/`approval.requested`/an immediate `tool.failed` for a denial, all
 * BEFORE the batch's single flush point (the empty-string `yield` below) - an approval that
 * can take minutes for a human to resolve must reach the client before this generator stops
 * yielding, not after. Pass 2 (inside `dispatchPlan`) performs the actual blocking work:
 * awaiting a frontend result, awaiting a human decision, or executing a backend tool.
 */
export function createToolCallingExecutor(options: CreateToolCallingExecutorOptions): Executor {
  const maxToolIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;

  return {
    async *execute(input: ExecutorInput, context: ExecutorContext) {
      const grants = new Map<string, ToolApprovalLevel>();
      const toolRuntime = createToolRuntime({
        middleware: options.actionFirewall ? [createActionFirewallMiddleware({
          firewall: options.actionFirewall,
          resolver: options.securityToolResolver ?? options.backendToolResolver,
          getContext: () => options.refreshSecurityContext?.() ?? options.securityContext ?? {},
          revalidation: true,
          hasApproval: (id, level) => { const grant = grants.get(id); return grant !== undefined && strongerApprovalLevel(grant, level) === grant; },
        })] : [],
        resolver: options.backendToolResolver,
        defaultTimeoutMs: options.toolTimeoutMs,
        onEvent: (event) => {
          if (event.phase === 'completed' && options.dataPolicy) {
            context.onToolEvent?.({ ...event, result: options.dataPolicy.redact(event.result) });
            return;
          }
          context.onToolEvent?.(event);
        },
      });

      let messages: ModelMessage[] = input.messages.map(({ role, content }) => ({
        role,
        content: content.map((part) => part.type === 'text' && options.dataPolicy?.redactText
          ? { ...part, text: options.dataPolicy.redactText(part.text) } : part),
      }));
      let iterations = 0;
      const seenCalls = new Set<string>();
      const pendingApprovals = new Set<string>();
      const cancelPending = (): void => { for (const id of pendingApprovals) void options.approvals?.cancel(id); };
      context.signal.addEventListener('abort', cancelPending, { once: true });
      try {

      while (true) {
        const backendTools = await options.backendToolResolver.resolve({
          runId: context.runId,
          threadId: input.threadId,
        });
        const securityBackendTools = options.securityToolResolver
          ? await options.securityToolResolver.resolve({ runId: context.runId, threadId: input.threadId })
          : backendTools;
        const manifest: readonly ToolManifestEntry[] = [
          ...toToolManifest(backendTools),
          ...options.frontendTools,
        ];

        let usage;
        let finishReason;
        const toolCallsThisTurn: ToolCall[] = [];

        if (options.action) {
          if (iterations > 0) return {};
          toolCallsThisTurn.push({ id: randomUUID(), ...options.action });
        } else {
        if (!options.modelRuntime) throw CopilotError.validation('A model runtime is required.');
        for await (const event of options.modelRuntime.stream({
          model: options.model,
          messages,
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
          metadata: options.metadata,
          timeoutMs: options.timeoutMs,
          signal: context.signal,
          tools: manifest.length > 0 ? toModelToolDefinitions(manifest) : undefined,
        })) {
          switch (event.type) {
            case 'model.started':
              break;
            case 'content.delta':
              yield event.delta;
              break;
            case 'usage.updated':
              usage = event.usage;
              break;
            case 'tool_call.requested':
              toolCallsThisTurn.push(event.toolCall);
              break;
            case 'model.completed':
              finishReason = event.finishReason;
              usage = event.usage ?? usage;
              break;
            case 'model.failed':
              throw new CopilotError(event.error.code, event.error.message, {
                retryable: event.error.retryable,
                metadata: event.error.metadata,
              });
            default: {
              const exhaustive: never = event;
              throw new Error(`Unhandled model stream event: ${JSON.stringify(exhaustive)}`);
            }
          }
        }

        }

        if (toolCallsThisTurn.length === 0) {
          return { usage, finishReason };
        }

        iterations += 1;
        if (iterations > maxToolIterations) {
          throw CopilotError.toolIterationLimitExceeded(maxToolIterations);
        }

        messages = [...messages, assistantToolCallMessage(toolCallsThisTurn)];

        // Pass 1 (Section 70-72): evaluate the firewall for every call, announcing
        // `tool.requested` for all of them and `approval.requested`/an immediate denial as
        // applicable - entirely before the flush point below. See this function's own doc
        // comment for why this must happen before, not during, pass 2's blocking awaits.
        const frontendNames = new Set(options.frontendTools.map((entry) => entry.name));
        const plans: DispatchPlan[] = [];
        for (const call of toolCallsThisTurn) {
          const source = frontendNames.has(call.name) ? 'frontend' : 'native';
          const announce = (): void => context.onToolEvent?.({
            phase: 'requested', toolCallId: call.id, name: call.name,
            arguments: (options.dataPolicy?.redact(call.arguments) ?? call.arguments) as Readonly<Record<string, unknown>>, source,
          });
          // A frontend requested event is an execution command. Emit only at dispatch,
          // after authorization and approval; never while still evaluating the action.
          if (source !== 'frontend') announce();
          if (seenCalls.has(call.id)) {
            const error = CopilotError.validation('Duplicate tool call identifier.').toPublicJSON();
            context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
            plans.push({ kind: 'denied', call, result: { status: 'error', toolCallId: call.id, error } });
            continue;
          }
          seenCalls.add(call.id);

          if (!options.actionFirewall) {
            plans.push({ kind: 'proceed', call });
            continue;
          }

          const definition = source === 'frontend'
            ? options.frontendDefinitions?.find((tool) => tool.name === call.name)
            : securityBackendTools.find((tool) => tool.name === call.name);
          if (!definition) {
            const error = CopilotError.toolNotFound(call.name).toPublicJSON();
            context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
            plans.push({ kind: 'denied', call, result: { status: 'error', toolCallId: call.id, error } });
            continue;
          }
          const security = definition.security;
          const actionRequest: ActionRequest = {
            actionId: call.id,
            runId: context.runId,
            toolCallId: call.id,
            action: call.name,
            arguments: call.arguments,
            metadata: actionMetadataOf(call.name, source === 'frontend' ? 'frontend' : 'backend', security),
          };
          const currentSecurity = options.refreshSecurityContext ? await options.refreshSecurityContext() : options.securityContext ?? {};
          const decision = await options.actionFirewall.evaluate(actionRequest, currentSecurity);

          if (decision.decision === 'deny') {
            const error = errorForDenial(decision.reason).toPublicJSON();
            context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
            plans.push({ kind: 'denied', call, result: { status: 'error', toolCallId: call.id, error } });
            continue;
          }

          if (!definition.inputSchema.safeParse(call.arguments).success) {
            const error = CopilotError.validation('Invalid tool arguments.').toPublicJSON();
            context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
            plans.push({ kind: 'denied', call, result: { status: 'error', toolCallId: call.id, error } });
            continue;
          }

          if (decision.decision === 'approval') {
            if (!options.approvals) {
              const error = CopilotError.internal(
                'This action requires approval, but no ApprovalStore is configured.',
              ).toPublicJSON();
              context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
              plans.push({ kind: 'denied', call, result: { status: 'error', toolCallId: call.id, error } });
              continue;
            }

            const preview = await tryDryRun(call, securityBackendTools, context.runId, input.threadId, context.signal, currentSecurity);
            const approvalId = randomUUID();
            const safePreview = redactPreview(preview, options.dataPolicy);
            const created = await options.approvals.create({
              approvalId,
              actionId: call.id,
              runId: context.runId,
              toolCallId: call.id,
              requestedBy: currentSecurity.identity?.subject,
              tenantId: currentSecurity.tenant?.tenantId,
              approvalLevel: decision.approval.level,
              summary: safePreview?.summary ?? summaryFor(call),
              risk: actionRequest.metadata.risk,
              reversibility: actionRequest.metadata.reversibility,
              requiredPermissions: actionRequest.metadata.requiredPermissions,
              expiresInMs: options.approvalExpiresInMs ?? 15 * 60_000,
              preview: safePreview,
            });
            pendingApprovals.add(approvalId);
            if (context.signal.aborted) await options.approvals.cancel(approvalId);
            await recordAction(options, context, call, 'approval.requested', { approvalId, status: 'pending' });
            context.onToolEvent?.({
              phase: 'approval_requested',
              toolCallId: call.id,
              approvalId,
              action: call.name,
              approvalLevel: decision.approval.level,
              summary: created.summary,
              ...(actionRequest.metadata.risk !== undefined ? { risk: actionRequest.metadata.risk } : {}),
              ...(actionRequest.metadata.reversibility !== undefined
                ? { reversibility: actionRequest.metadata.reversibility }
                : {}),
              ...(created.expiresAt !== undefined ? { expiresAt: created.expiresAt } : {}),
              ...(safePreview !== undefined ? { preview: safePreview } : {}),
            });
            plans.push({ kind: 'awaiting-approval', call, approvalId, request: actionRequest, preview });
            continue;
          }

          plans.push({ kind: 'proceed', call });
        }

        // Flush point (Section 45's established pattern, reused): the client can only act on
        // an event it has actually received - without this, a pending approval or frontend
        // tool call below would deadlock inside this same unresolved `execute()` step.
        yield '';

        const results = await dispatchPlans(plans, {
          backendTools,
          frontendManifest: options.frontendTools,
          frontendDefinitions: options.frontendDefinitions,
          toolRuntime,
          frontendToolBridge: options.frontendToolBridge,
          context,
          threadId: input.threadId,
          frontendToolTimeoutMs: options.frontendToolTimeoutMs,
          approvals: options.approvals,
          grants,
          actionFirewall: options.actionFirewall,
          securityContext: options.securityContext,
          refreshSecurityContext: options.refreshSecurityContext,
          dataPolicy: options.dataPolicy,
        });

        for (const result of results) {
          messages = [...messages, toolResultMessage(result)];
        }
      }
      } finally {
        context.signal.removeEventListener('abort', cancelPending);
        cancelPending();
      }
    },
  };
}

interface DispatchOptions {
  readonly grants: Map<string, ToolApprovalLevel>;
  readonly backendTools: readonly AnyToolDefinition[];
  readonly frontendManifest: readonly ToolManifestEntry[];
  readonly frontendDefinitions?: readonly AnyToolDefinition[];
  readonly toolRuntime: ReturnType<typeof createToolRuntime>;
  readonly frontendToolBridge: FrontendToolBridge;
  readonly context: ExecutorContext;
  readonly threadId: ThreadId | undefined;
  readonly frontendToolTimeoutMs?: number;
  readonly approvals?: ApprovalStore;
  readonly actionFirewall?: ActionFirewall;
  readonly securityContext?: SecurityContext;
  readonly refreshSecurityContext?: () => Promise<SecurityContext> | SecurityContext;
  readonly dataPolicy?: DataPolicy;
}

function dispatchPlans(
  plans: readonly DispatchPlan[],
  options: DispatchOptions,
): Promise<readonly ToolResult[]> {
  return runWithConcurrencyPlan(
    plans,
    (plan) => options.backendTools.find((tool) => tool.name === plan.call.name)?.metadata?.concurrency,
    (plan) => dispatchPlan(plan, options),
  );
}

async function dispatchPlan(plan: DispatchPlan, options: DispatchOptions): Promise<ToolResult> {
  if (plan.kind === 'denied') return plan.result;

  if (plan.kind === 'awaiting-approval') {
    const resolvedResult = await resolveApproval(plan, options);
    if (resolvedResult) return resolvedResult;
    // Approved and re-authorized (Section 39, 42, 44) - fall through to normal dispatch.
  }

  if (options.context.signal.aborted) return { status: 'error', toolCallId: plan.call.id, error: CopilotError.cancelled().toPublicJSON() };
  await recordAction(options, options.context, plan.call, 'execution.started');
  const result = await dispatchCall(plan.call, options);
  await recordAction(options, options.context, plan.call, 'execution.completed', undefined, result.status);
  if (result.status === 'error') options.context.onToolEvent?.({ phase: 'failed', toolCallId: plan.call.id, name: plan.call.name, error: result.error });
  return result;
}

/**
 * Waits for the human decision (Section 38-39), then re-evaluates the firewall before
 * allowing execution (Section 42, 44 - "security MUST be re-evaluated ... approval is not a
 * permanent bypass token"). Returns a `ToolResult` for every terminal outcome except a fresh
 * `allow`, in which case it returns `undefined` so the caller falls through to normal
 * dispatch.
 */
async function resolveApproval(
  plan: Extract<DispatchPlan, { kind: 'awaiting-approval' }>,
  options: DispatchOptions,
): Promise<ToolResult | undefined> {
  const { call, approvalId } = plan;
  const approvals = options.approvals;
  if (!approvals) {
    return { status: 'error', toolCallId: call.id, error: CopilotError.internal('Missing ApprovalStore.').toPublicJSON() };
  }

  let decided;
  try {
    decided = await approvals.awaitDecision(approvalId, { signal: options.context.signal });
  } catch {
    // Aborted - the run was cancelled while this approval was pending (Section 42, 103).
    await approvals.cancel(approvalId).catch(() => undefined);
    return { status: 'error', toolCallId: call.id, error: CopilotError.cancelled().toPublicJSON() };
  }

  await recordAction(options, options.context, call, `approval.${decided.status}`, { approvalId, status: decided.status });
  if (decided.status === 'rejected') {
    const decidedBy = decided.approvals.at(-1)?.approverSubject;
    options.context.onToolEvent?.({
      phase: 'approval_rejected',
      toolCallId: call.id,
      approvalId,
      ...(decidedBy !== undefined ? { decidedBy } : {}),
    });
    const error = CopilotError.approvalRejected().toPublicJSON();
    options.context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
    return { status: 'error', toolCallId: call.id, error };
  }

  if (decided.status === 'expired') {
    options.context.onToolEvent?.({ phase: 'approval_expired', toolCallId: call.id, approvalId });
    const error = CopilotError.approvalExpired().toPublicJSON();
    options.context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
    return { status: 'error', toolCallId: call.id, error };
  }

  if (decided.status === 'cancelled') {
    return { status: 'error', toolCallId: call.id, error: CopilotError.cancelled().toPublicJSON() };
  }

  if (decided.status !== 'approved' || options.context.signal.aborted) {
    return { status: 'error', toolCallId: call.id, error: CopilotError.cancelled().toPublicJSON() };
  }
  // decided.status === 'approved' 
  const decidedBy = decided.approvals.at(-1)?.approverSubject;
  options.context.onToolEvent?.({
    phase: 'approval_approved',
    toolCallId: call.id,
    approvalId,
    ...(decidedBy !== undefined ? { decidedBy } : {}),
  });

  const freshContext = options.refreshSecurityContext
    ? await options.refreshSecurityContext()
    : (options.securityContext ?? {});
  const revalidated = options.actionFirewall
    ? await options.actionFirewall.evaluate({ ...plan.request, revalidation: true }, freshContext)
    : { decision: 'allow' as const };

  if (revalidated.decision === 'deny') {
    const error = errorForDenial(revalidated.reason).toPublicJSON();
    options.context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
    return { status: 'error', toolCallId: call.id, error };
  }
  if (revalidated.decision === 'approval') {
    // The risk policy is stateless - re-evaluating the SAME action always re-derives an
    // approval requirement, since it has no notion of "already granted." Revalidation is
    // therefore not "does this still need approval" (trivially always yes) but "is this
    // still authorized at all, at no MORE than the level a human already granted" - Section
    // 42/44's re-evaluation is about permission/policy/tenant changes since the request was
    // made, not about re-litigating the approval decision itself. Only a *stronger*
    // requirement than what was already satisfied (e.g. a policy escalation mid-flight) is
    // treated as a fresh denial rather than silently looping into another approval.
    const stillWithinGrantedLevel =
      strongerApprovalLevel(revalidated.approval.level, decided.approvalLevel) === decided.approvalLevel;
    if (!stillWithinGrantedLevel) {
      const error = CopilotError.internal(
        'Re-evaluation after approval required a stronger approval level than was granted; treated as denied.',
      ).toPublicJSON();
      options.context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
      return { status: 'error', toolCallId: call.id, error };
    }
  }

  if (freshContext.identity?.subject !== decided.requestedBy || freshContext.tenant?.tenantId !== decided.tenantId) {
    return { status: 'error', toolCallId: call.id, error: CopilotError.permissionDenied('resume this action').toPublicJSON() };
  }
  if (plan.preview !== undefined) {
    const freshPreview = await tryDryRun(call, options.backendTools, options.context.runId, options.threadId, options.context.signal, freshContext);
    if (JSON.stringify(freshPreview) !== JSON.stringify(plan.preview)) {
      const error = new CopilotError('POLICY_DENIED', 'The resource changed after the preview. Request a new approval.').toPublicJSON();
      options.context.onToolEvent?.({ phase: 'failed', toolCallId: call.id, name: call.name, error });
      return { status: 'error', toolCallId: call.id, error };
    }
  }
  options.grants.set(call.id, decided.approvalLevel);
  return undefined; // Allowed - proceed to normal dispatch.
}

async function dispatchCall(call: ToolCall, options: DispatchOptions): Promise<ToolResult> {
  const isFrontend = options.frontendManifest.some((entry) => entry.name === call.name);

  if (isFrontend) {
    const pendingResult = options.frontendToolBridge.awaitResult(
      options.context.runId,
      call.id,
      call.name,
      { signal: options.context.signal, timeoutMs: options.frontendToolTimeoutMs },
    );
    options.context.onToolEvent?.({ phase: 'requested', toolCallId: call.id, name: call.name, arguments: call.arguments, source: 'frontend' });
    options.context.onToolEvent?.({ phase: 'started', toolCallId: call.id, name: call.name });
    let result = await pendingResult;
    const definition = options.frontendDefinitions?.find((tool) => tool.name === call.name);
    if (result.status === 'success' && definition?.outputSchema && !definition.outputSchema.safeParse(result.data).success) {
      result = { status: 'error', toolCallId: call.id, error: CopilotError.toolOutputInvalid('Invalid browser tool result.').toPublicJSON() };
    }
    if (result.status === 'success' && options.dataPolicy) result = { ...result, data: options.dataPolicy.redact(result.data) };
    if (result.status === 'success') {
      options.context.onToolEvent?.({
        phase: 'completed',
        toolCallId: call.id,
        name: call.name,
        result: result.data,
      });
    } else {
      options.context.onToolEvent?.({
        phase: 'failed',
        toolCallId: call.id,
        name: call.name,
        error: result.error,
      });
    }
    return result;
  }

  const result = await options.toolRuntime.execute({
    toolCallId: call.id,
    name: call.name,
    arguments: call.arguments,
    context: {
      runId: options.context.runId,
      threadId: options.threadId,
      signal: options.context.signal,
      metadata: { securityContext: options.refreshSecurityContext ? await options.refreshSecurityContext() : options.securityContext },
    },
  });
  // Section 56: the model must see the same redacted data the client does - never the raw
  // result the tool itself produced (which the `onEvent` wrapping above already redacted for
  // the `tool.completed` event; this redacts the copy that becomes the model's own message).
  if (result.status === 'success' && options.dataPolicy) {
    return { ...result, data: options.dataPolicy.redact(result.data) };
  }
  return result;
}

/** Reads one property off an `unknown` value without ever assigning an `any` - `Reflect.get`
 * itself is typed `any`, which is what this narrows back down to `unknown`. */
function getUnknownProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** Preview changes use dynamic field names; redact values by their declared field. */
function redactPreview(preview: ToolActionPreview | undefined, policy?: DataPolicy): ToolActionPreview | undefined {
  if (!preview || !policy) return preview;
  return {
    ...preview,
    summary: policy.redactText?.(preview.summary) ?? preview.summary,
    warnings: preview.warnings?.map((warning) => policy.redactText?.(warning) ?? warning),
    changes: preview.changes?.map((change) => {
      const before = policy.redact({ [change.field]: change.before });
      const after = policy.redact({ [change.field]: change.after });
      return {
        field: change.field,
        before: getUnknownProperty(before, change.field),
        after: getUnknownProperty(after, change.field),
      };
    }),
  };
}

async function recordAction(
  options: Pick<CreateToolCallingExecutorOptions, 'actionFirewall' | 'securityContext'>,
  context: ExecutorContext,
  call: ToolCall,
  decision: string,
  approval?: AuditRecord['approval'],
  resultStatus?: 'success' | 'error',
): Promise<void> {
  await options.actionFirewall?.record?.({
    id: randomUUID(), timestamp: new Date().toISOString(),
    tenantId: options.securityContext?.tenant?.tenantId,
    actor: { kind: 'user', subject: options.securityContext?.identity?.subject },
    action: call.name, tool: call.name, runId: context.runId, toolCallId: call.id,
    decision, approval, resultStatus,
  });
}
