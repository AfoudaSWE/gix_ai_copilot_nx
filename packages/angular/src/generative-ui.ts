import { ChangeDetectionStrategy, Component, DestroyRef, Injectable, Input, computed, inject, signal } from '@angular/core';
import type { Type } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import type { z } from 'zod';
import { toGenerativeUiToolDefinition } from '@gixcopilot/generative-ui';
import type { AnyGenerativeComponentDefinition, GenerativeComponentMetadata } from '@gixcopilot/generative-ui';
import type { GenerativeUIRequestState } from '@gixcopilot/headless';
import { CopilotService } from './copilot.service.js';

interface RegisteredComponent {
  readonly definition: AnyGenerativeComponentDefinition;
  readonly component: Type<unknown>;
}

/**
 * The trusted Angular half of generative UI (Phase 6): maps a registered component name to
 * an Angular component class the application wrote. The model can only *select* a registered
 * name and supply props that pass the component's schema; it can never supply a template,
 * markup or code, and nothing here compiles anything at runtime.
 */
@Injectable()
export class CopilotComponentRegistry {
  private readonly copilot = inject(CopilotService);
  private readonly components = new Map<string, RegisteredComponent>();

  /** Registers a component and its reserved render tool; returns an unregister function. */
  register<TProps>(options: GenerativeComponentOptions<TProps>): () => void {
    const definition: AnyGenerativeComponentDefinition = {
      name: options.name,
      description: options.description,
      propsSchema: options.props,
      metadata: options.metadata,
    };
    const { generativeComponentRegistry, toolRegistry } = this.copilot.parts;
    const componentRegistration = generativeComponentRegistry.register(definition, { replace: true });
    const toolRegistration = toolRegistry.register({ ...toGenerativeUiToolDefinition(definition), enabled: options.enabled }, { replace: true });
    const entry: RegisteredComponent = { definition, component: options.component };
    this.components.set(options.name, entry);
    return () => {
      toolRegistration.dispose();
      componentRegistration.dispose();
      if (this.components.get(options.name) === entry) this.components.delete(options.name);
    };
  }

  /**
   * Resolves a succeeded request to a component and schema-validated inputs, or `undefined`.
   * Props are validated again here (they were validated when the tool executed) so a renderer
   * never receives data the component's schema rejects.
   */
  resolve(request: GenerativeUIRequestState): { readonly component: Type<unknown>; readonly inputs: Record<string, unknown> } | undefined {
    if (request.status !== 'succeeded') return undefined;
    const entry = this.components.get(request.component);
    if (!entry) return undefined;
    const parsed = entry.definition.propsSchema.safeParse(request.props);
    if (!parsed.success || typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) return undefined;
    return { component: entry.component, inputs: parsed.data as Record<string, unknown> };
  }
}

export interface GenerativeComponentOptions<TProps> {
  readonly name: string;
  readonly description: string;
  readonly props: z.ZodType<TProps>;
  /** An application-owned Angular component whose inputs match `props`. */
  readonly component: Type<unknown>;
  readonly metadata?: GenerativeComponentMetadata;
  readonly enabled?: boolean | (() => boolean);
}

/** Registers a trusted generative component for the lifetime of the current injection context. */
export function injectGenerativeComponent<TProps>(options: GenerativeComponentOptions<TProps>): void {
  const unregister = inject(CopilotComponentRegistry).register(options);
  inject(DestroyRef).onDestroy(unregister);
}

/**
 * Renders one generative-UI request with its registered component. Unregistered components,
 * failed requests and props that fail validation render nothing.
 */
@Component({
  selector: 'aicopilot-generative-ui',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resolved(); as view) {
      <ng-container *ngComponentOutlet="view.component; inputs: view.inputs" />
    }
  `,
})
export class GenerativeUiOutletComponent {
  private readonly registry = inject(CopilotComponentRegistry);
  // Decorator inputs feeding a signal (rather than `input()`), so the component behaves the
  // same under AOT and JIT compilation.
  private readonly current = signal<GenerativeUIRequestState | undefined>(undefined);
  @Input({ required: true })
  set request(value: GenerativeUIRequestState) {
    this.current.set(value);
  }
  get request(): GenerativeUIRequestState | undefined {
    return this.current();
  }
  protected readonly resolved = computed(() => {
    const request = this.current();
    return request ? this.registry.resolve(request) : undefined;
  });
}
