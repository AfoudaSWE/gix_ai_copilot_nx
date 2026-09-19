import { CopilotError } from '@gixcopilot/protocol';
import type { StatePatch, StatePatchResult } from './state-patch.js';

/**
 * State's own scope vocabulary (Section 41) - deliberately smaller than `ContextScope`
 * (Section 8): state is either shared for the app's lifetime (`global`), shared for the
 * current workflow (`session`), or owned by one mounted component (`component`). State does
 * not have a `page`/`user`/`temporary` distinction the way context does - see
 * `Phase_4_Decisions.md` ("State vs Context separation").
 */
export type StateScope = 'global' | 'session' | 'component';

export interface StateValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export type StateValidator<T> = (value: T) => boolean | StateValidationResult;

export interface CopilotStateDefinition<T> {
  readonly id: string;
  readonly name: string;
  readonly initialValue: T;
  readonly scope?: StateScope;
  readonly validate?: StateValidator<T>;
  /**
   * Capability metadata (Section 38-39, added in Phase 6) - `true` allows this slot to
   * accept a validated `applyPatch()` call (typically from an AI-proposed patch, via a
   * reserved tool - see `@gixcopilot/generative-ui`). Defaults to `false`: a slot is
   * read-only from the model's perspective unless explicitly opted in, mirroring
   * `@gixcopilot/context`'s own "nothing is exposed unless explicit" convention from Phase 4.
   * This is capability metadata, not enforcement of *who* may call `applyPatch()` - Phase 7
   * will add real authorization.
   */
  readonly modelWritable?: boolean;
}

/**
 * A framework-independent, typed, subscribable state slot store (Section 42). Distinct from
 * `ContextRegistry`: this holds *mutable application/Copilot data*; nothing here is
 * automatically model-facing (Section 44) - bridging a specific slot to context is an
 * explicit, separate act performed by the caller (see `Phase_4_Decisions.md`, "State
 * exposure policy").
 */
export interface CopilotStateStore {
  /**
   * Ensures `definition.id` exists, seeding it with `initialValue` the first time only
   * (later calls for the same id do not reset an already-set value - Section 18's
   * "identity by explicit id" rule applies here too). Returns the slot's current value.
   * Always refreshes the stored `validate`/`scope` to the latest definition passed in.
   */
  register<T>(definition: CopilotStateDefinition<T>): T;
  has(id: string): boolean;
  get<T>(id: string): T | undefined;
  /** Validates (if a validator was registered) then replaces the value; throws on failure. */
  set<T>(id: string, value: T): void;
  /** Functional update (Section 48) - reads the previous value, validates, then replaces. */
  update<T>(id: string, updater: (previous: T) => T): void;
  /** Notified on every `set`/`update`/successfully-applied patch for this id. Removing the id
   * does not auto-unsubscribe. */
  subscribe<T>(id: string, listener: (value: T) => void): () => void;
  remove(id: string): void;
  list(): readonly string[];
  /**
   * Monotonically increases on every successful `set`/`update`/`applyPatch` for this id
   * (Section 45) - not just patches, so a stale AI-proposed `baseRevision` is detected even
   * when the *UI* (not another patch) moved the value in the meantime (Section 46).
   * `undefined` for an unregistered id.
   */
  getRevision(id: string): number | undefined;
  isModelWritable(id: string): boolean;
  /**
   * The validated state-patch pipeline (Section 43): unknown id / not writable / stale
   * `baseRevision` / schema-invalid result each return a distinct, non-throwing
   * `StatePatchResult` - state is left completely unchanged unless `status: 'applied'`
   * (Section 43's "invalid patch must not mutate state", satisfied structurally: nothing is
   * written until every check has already passed).
   */
  applyPatch(id: string, patch: StatePatch, baseRevision: number): StatePatchResult;
}

interface Slot {
  value: unknown;
  scope: StateScope;
  validate?: StateValidator<unknown>;
  modelWritable: boolean;
  revision: number;
  readonly listeners: Set<(value: unknown) => void>;
}

function validateForPatch<T>(
  validate: StateValidator<T> | undefined,
  value: T,
): { readonly valid: boolean; readonly error?: string } {
  if (!validate) return { valid: true };
  const result = validate(value);
  if (typeof result === 'boolean') return { valid: result };
  return result;
}

function assertValid<T>(validate: StateValidator<T> | undefined, value: T): void {
  if (!validate) return;
  const result = validate(value);
  const valid = typeof result === 'boolean' ? result : result.valid;
  if (!valid) {
    const message =
      typeof result === 'object' && result.error ? result.error : 'Rejected state update.';
    throw CopilotError.validation(message);
  }
}

/**
 * Creates an isolated store - no mandatory global singleton (Section 42); a host creates
 * one per independent Copilot instance, mirroring `createContextRegistry()`.
 */
export function createCopilotStateStore(): CopilotStateStore {
  const slots = new Map<string, Slot>();

  function requireSlot(id: string): Slot {
    const slot = slots.get(id);
    if (!slot) {
      throw CopilotError.validation('No state registered with that id.', { id });
    }
    return slot;
  }

  function notify(slot: Slot): void {
    for (const listener of slot.listeners) listener(slot.value);
  }

  return {
    register<T>(definition: CopilotStateDefinition<T>): T {
      const existing = slots.get(definition.id);
      if (existing) {
        existing.scope = definition.scope ?? existing.scope;
        existing.validate = definition.validate as StateValidator<unknown> | undefined;
        existing.modelWritable = definition.modelWritable ?? existing.modelWritable;
        return existing.value as T;
      }
      const slot: Slot = {
        value: definition.initialValue,
        scope: definition.scope ?? 'component',
        validate: definition.validate as StateValidator<unknown> | undefined,
        modelWritable: definition.modelWritable ?? false,
        revision: 0,
        listeners: new Set(),
      };
      slots.set(definition.id, slot);
      return definition.initialValue;
    },
    has: (id) => slots.has(id),
    get: <T>(id: string) => slots.get(id)?.value as T | undefined,
    set<T>(id: string, value: T): void {
      const slot = requireSlot(id);
      assertValid(slot.validate as StateValidator<T> | undefined, value);
      slot.value = value;
      slot.revision += 1;
      notify(slot);
    },
    update<T>(id: string, updater: (previous: T) => T): void {
      const slot = requireSlot(id);
      const next = updater(slot.value as T);
      assertValid(slot.validate as StateValidator<T> | undefined, next);
      slot.value = next;
      slot.revision += 1;
      notify(slot);
    },
    subscribe<T>(id: string, listener: (value: T) => void): () => void {
      const slot = requireSlot(id);
      const wrapped = listener as (value: unknown) => void;
      slot.listeners.add(wrapped);
      return () => {
        slot.listeners.delete(wrapped);
      };
    },
    remove(id) {
      slots.delete(id);
    },
    list: () => Array.from(slots.keys()),
    getRevision: (id) => slots.get(id)?.revision,
    isModelWritable: (id) => slots.get(id)?.modelWritable ?? false,
    applyPatch(id: string, patch: StatePatch, baseRevision: number): StatePatchResult {
      const slot = slots.get(id);
      if (!slot) return { status: 'rejected', reason: 'unknown-state' };
      if (!slot.modelWritable) return { status: 'rejected', reason: 'not-writable' };
      if (slot.revision !== baseRevision) {
        return { status: 'conflict', currentRevision: slot.revision };
      }

      let nextValue: unknown;
      if (patch.op === 'set') {
        nextValue = patch.value;
      } else {
        const current = slot.value;
        if (!isPlainObject(current) || !isPlainObject(patch.value)) {
          return {
            status: 'rejected',
            reason: 'invalid-patch',
            detail: 'A "merge" patch requires both the current and patched value to be plain objects.',
          };
        }
        nextValue = { ...current, ...patch.value };
      }

      const validation = validateForPatch(slot.validate, nextValue);
      if (!validation.valid) {
        return { status: 'rejected', reason: 'invalid-value', detail: validation.error };
      }

      slot.value = nextValue;
      slot.revision += 1;
      notify(slot);
      return { status: 'applied', revision: slot.revision, value: nextValue };
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}
