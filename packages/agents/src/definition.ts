import type { z } from 'zod';
import type { SecurityContext } from '@gixcopilot/security';
import type { AgentLimits } from './limits.js';

/**
 * The data a dynamic instructions factory may read (Section 25-26). Deliberately narrow and
 * fully trusted-or-declared: `securityContext` comes only from the runtime (never from model
 * output), `input` is the agent's own already-schema-validated input. An instructions
 * factory must not be handed raw untrusted text to interpolate without the caller's own
 * judgment - it composes a string from data it already trusts.
 */
export interface AgentInstructionsContext<TInput = unknown> {
  readonly securityContext: SecurityContext;
  readonly input: TInput;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AgentInstructions<TInput = unknown> =
  | string
  | ((context: AgentInstructionsContext<TInput>) => string);

/**
 * The stored form of `AgentDefinition.instructions` - always a callable, normalized by
 * `defineAgent()` from either a plain string or a factory (Section 25). Declared with
 * interface method shorthand (`resolve(context): string`, not `resolve: (context) => string`)
 * for the exact reason `@gixcopilot/tools`' `ToolDefinition.execute` is: TypeScript checks
 * method signatures bivariantly, which is what lets an `AgentDefinition<Specific, ...>` be
 * stored/passed around as `AnyAgentDefinition` (a heterogeneous collection of differently-
 * input-typed agents, exactly what a registry holds) without an unsound or explicit cast. A
 * property typed as a plain function (`(context) => string`) would be checked contravariantly
 * instead and fail that same assignment.
 */
export interface AgentInstructionsResolver<TInput = unknown> {
  resolve(context: AgentInstructionsContext<TInput>): string;
}

/** A provider-neutral model selection (Section 23-24) - resolved through Phase 2's model
 * runtime, never by calling a provider SDK directly from agent core. */
export interface AgentModelConfig {
  readonly provider?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

/**
 * Static allowlist or a dynamic selector re-evaluated per run (Section 33-34). Never "every
 * registered tool" implicitly - an agent with no `tools` declared gets none, by design (least
 * privilege, Section 53).
 */
export type AgentToolSelector = readonly string[] | ((context: AgentInstructionsContext) => readonly string[]);

/** Section 36 - which knowledge sources this agent may draw on. Actual retrieval/ACL
 * enforcement stays with Phase 9's `@gixcopilot/rag`; this is declarative configuration the
 * composition layer (server/example) uses to scope retrieval, not a retrieval call itself. */
export interface AgentKnowledgeConfig {
  readonly sources: readonly string[];
}

/** Section 37-38 - which memory types this agent may read/write. Actual storage/policy stays
 * with Phase 9's `@gixcopilot/memory`. */
export interface AgentMemoryConfig {
  readonly types?: readonly ('working' | 'session' | 'durable' | 'semantic')[];
}

/**
 * Section 56-60 - which other agents this agent may delegate to (A -> B -> A) and hand off to
 * (A -> B, B becomes active). Both are static, developer-declared allowlists validated at run
 * time against the actual request - never expanded by a model-supplied target id (Section 65).
 */
export interface AgentDelegationConfig {
  readonly delegatesTo?: readonly string[];
  readonly handoffTargets?: readonly string[];
  /** Governs a turn where the model requests more than one `delegatesTo` target at once
   * (Section 70-73, parallel specialists): `'collect-results'` (default) runs every
   * delegation to completion and reports each outcome, even if some fail; `'fail-fast'`
   * cancels the remaining in-flight delegations as soon as one fails. */
  readonly parallelFailurePolicy?: 'fail-fast' | 'collect-results';
}

export interface AgentMetadata {
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly version?: string;
  readonly owner?: string;
  readonly description?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
}

/**
 * The canonical, framework-independent agent abstraction (Section 9). Declarative: no field
 * here is an opaque imperative script - see the agent-architecture skill. `enabled` mirrors
 * `@gixcopilot/tools`' `ToolDefinition.enabled` (Section 11-12: disabled, not deleted).
 */
export interface AgentDefinition<TInput = unknown, TOutput = unknown, TState = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly instructions: AgentInstructionsResolver<TInput>;
  readonly model?: AgentModelConfig;
  readonly inputSchema?: z.ZodType<TInput>;
  readonly outputSchema?: z.ZodType<TOutput>;
  readonly stateSchema?: z.ZodType<TState>;
  readonly tools?: AgentToolSelector;
  readonly knowledge?: AgentKnowledgeConfig;
  readonly memory?: AgentMemoryConfig;
  readonly delegation?: AgentDelegationConfig;
  readonly limits?: AgentLimits;
  readonly metadata?: AgentMetadata;
  readonly enabled?: boolean | (() => boolean);
}

/** The registry/runtime storage type, ignoring an agent's specific input/output/state types -
 * mirrors `@gixcopilot/tools`' `AnyToolDefinition` pattern. */
export type AnyAgentDefinition = AgentDefinition<unknown, unknown, unknown>;

export function isAgentEnabled(agent: AnyAgentDefinition): boolean {
  if (agent.enabled === undefined) return true;
  return typeof agent.enabled === 'function' ? agent.enabled() : agent.enabled;
}

const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function assertValidAgentId(id: string): void {
  if (!AGENT_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid agent id "${id}": must be lowercase kebab-case, starting with a letter (e.g. "support", "application-review").`,
    );
  }
}

export interface DefineAgentOptions<
  TInputSchema extends z.ZodType | undefined = undefined,
  TOutputSchema extends z.ZodType | undefined = undefined,
  TStateSchema extends z.ZodType | undefined = undefined,
> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly instructions: AgentInstructions<
    TInputSchema extends z.ZodType ? z.infer<TInputSchema> : unknown
  >;
  readonly model?: AgentModelConfig;
  readonly input?: TInputSchema;
  readonly output?: TOutputSchema;
  readonly state?: TStateSchema;
  readonly tools?: AgentToolSelector;
  readonly knowledge?: AgentKnowledgeConfig;
  readonly memory?: AgentMemoryConfig;
  readonly delegation?: AgentDelegationConfig;
  readonly limits?: AgentLimits;
  readonly metadata?: AgentMetadata;
  readonly enabled?: boolean | (() => boolean);
}

/** The ergonomic authoring API (Section 10) - mirrors `@gixcopilot/tools`' `defineTool` shape
 * (Zod schemas in, fully-inferred `AgentDefinition` out) so the two feel like one family. */
export function defineAgent<
  TInputSchema extends z.ZodType | undefined = undefined,
  TOutputSchema extends z.ZodType | undefined = undefined,
  TStateSchema extends z.ZodType | undefined = undefined,
>(
  options: DefineAgentOptions<TInputSchema, TOutputSchema, TStateSchema>,
): AgentDefinition<
  TInputSchema extends z.ZodType ? z.infer<TInputSchema> : unknown,
  TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown,
  TStateSchema extends z.ZodType ? z.infer<TStateSchema> : unknown
> {
  assertValidAgentId(options.id);
  type TInput = TInputSchema extends z.ZodType ? z.infer<TInputSchema> : unknown;
  type TOutput = TOutputSchema extends z.ZodType ? z.infer<TOutputSchema> : unknown;
  type TState = TStateSchema extends z.ZodType ? z.infer<TStateSchema> : unknown;

  const instructionsOption = options.instructions;
  const instructions: AgentInstructionsResolver<TInput> = {
    resolve:
      typeof instructionsOption === 'function'
        ? instructionsOption
        : () => instructionsOption,
  };

  const definition: AgentDefinition<TInput, TOutput, TState> = {
    id: options.id,
    name: options.name,
    description: options.description,
    instructions,
    model: options.model,
    inputSchema: options.input as z.ZodType<TInput> | undefined,
    outputSchema: options.output as z.ZodType<TOutput> | undefined,
    stateSchema: options.state as z.ZodType<TState> | undefined,
    tools: options.tools,
    knowledge: options.knowledge,
    memory: options.memory,
    delegation: options.delegation,
    limits: options.limits,
    metadata: options.metadata,
    enabled: options.enabled,
  };
  return definition;
}

export function resolveAgentInstructions<TInput>(
  agent: AgentDefinition<TInput, unknown, unknown>,
  context: AgentInstructionsContext<TInput>,
): string {
  return agent.instructions.resolve(context);
}

export function resolveAgentToolNames(
  agent: AnyAgentDefinition,
  context: AgentInstructionsContext,
): readonly string[] {
  if (!agent.tools) return [];
  return typeof agent.tools === 'function' ? agent.tools(context) : agent.tools;
}
