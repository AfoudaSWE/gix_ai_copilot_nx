import { CopilotError } from '@gixcopilot/protocol';

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
  /** Notified on every `set`/`update` for this id. Removing the id does not auto-unsubscribe. */
  subscribe<T>(id: string, listener: (value: T) => void): () => void;
  remove(id: string): void;
  list(): readonly string[];
}

interface Slot {
  value: unknown;
  scope: StateScope;
  validate?: StateValidator<unknown>;
  readonly listeners: Set<(value: unknown) => void>;
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
        return existing.value as T;
      }
      const slot: Slot = {
        value: definition.initialValue,
        scope: definition.scope ?? 'component',
        validate: definition.validate as StateValidator<unknown> | undefined,
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
      notify(slot);
    },
    update<T>(id: string, updater: (previous: T) => T): void {
      const slot = requireSlot(id);
      const next = updater(slot.value as T);
      assertValid(slot.validate as StateValidator<T> | undefined, next);
      slot.value = next;
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
  };
}
