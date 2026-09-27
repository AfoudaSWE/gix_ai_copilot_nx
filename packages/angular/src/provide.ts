import type { Provider } from '@angular/core';
import { COPILOT_CONFIG } from './config.js';
import type { CopilotConfig } from './config.js';
import { CopilotService } from './copilot.service.js';
import { CopilotComponentRegistry } from './generative-ui.js';

/**
 * Provides a copilot instance. Use it in `bootstrapApplication(App, { providers: [...] })` for
 * an app-wide copilot, or in a component's `providers` for an isolated one (its own chat,
 * context, tools and state, destroyed with that component).
 */
export function provideCopilot(config: CopilotConfig): Provider[] {
  return [{ provide: COPILOT_CONFIG, useValue: config }, CopilotService, CopilotComponentRegistry];
}
