import type { z } from 'zod';

/**
 * Extensible, optional component metadata (Section 14). Every field is optional and the
 * shape stays small - "do not over-design" is explicit in the brief. `interactive` and
 * `supportsState` are guidance for a host building its own component catalog UI; neither is
 * read by this package's own pipeline.
 */
export interface GenerativeComponentMetadata {
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly interactive?: boolean;
  readonly supportsStreaming?: boolean;
  readonly supportsState?: boolean;
  readonly version?: string;
  readonly custom?: Readonly<Record<string, unknown>>;
}

/**
 * The canonical, framework-neutral trusted-component contract (Section 8). Deliberately has
 * **no** field referencing an actual renderer (no `component: ComponentType`) - a React (or
 * future Angular) component reference is framework-specific and lives only in that
 * framework's own adapter (`@gixcopilot/react`'s `useGenerativeComponent`), never here. This
 * package only ever sees `name`/`description`/`propsSchema`/`metadata` - enough to build a
 * validated, discoverable, model-facing capability, never enough to render anything by
 * itself. See docs/adr/0011-generative-ui-and-state-patch-architecture.md.
 */
export interface GenerativeComponentDefinition<TProps = unknown> {
  readonly name: string;
  readonly description: string;
  readonly propsSchema: z.ZodType<TProps>;
  readonly metadata?: GenerativeComponentMetadata;
}

/** Any component definition, ignoring its specific props type - the registry's storage type. */
export type AnyGenerativeComponentDefinition = GenerativeComponentDefinition<unknown>;
