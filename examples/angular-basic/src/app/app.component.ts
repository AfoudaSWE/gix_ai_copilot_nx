import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { z } from 'zod';
import {
  CopilotChatComponent,
  injectCopilot,
  injectCopilotContext,
  injectCopilotState,
  injectFrontendTool,
  injectGenerativeComponent,
} from '@gixcopilot/angular';

/** A trusted, application-owned component the model may *select* (never author). */
@Component({
  selector: 'app-status-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="status-card"><strong>{{ applicationId }}</strong>: {{ status }}</p>`,
})
export class StatusCardComponent {
  @Input({ required: true }) applicationId = '';
  @Input({ required: true }) status = '';
}

@Component({
  selector: 'app-root',
  imports: [CopilotChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>Angular copilot</h1>
      <p>Status: {{ copilot.status() }} · Theme: {{ theme.value() }}</p>
      <aicopilot-chat label="Support copilot" />
    </main>
  `,
})
export class AppComponent {
  protected readonly copilot = injectCopilot();
  private readonly route = signal({ route: '/applications/APP-1024', title: 'Application APP-1024' });
  protected readonly theme = injectCopilotState({ id: 'theme', name: 'Theme', initialValue: 'light', exposeToModel: true });

  constructor() {
    injectCopilotContext({ id: 'current-page', name: 'Current page', value: this.route });
    injectFrontendTool({
      name: 'navigation.openApplication',
      description: 'Open an application by id in the UI',
      input: z.object({ applicationId: z.string() }),
      execute: ({ applicationId }) => {
        this.route.set({ route: `/applications/${applicationId}`, title: `Application ${applicationId}` });
        return Promise.resolve({ opened: applicationId });
      },
    });
    injectGenerativeComponent({
      name: 'statusCard',
      description: 'Show the status of an application',
      props: z.object({ applicationId: z.string(), status: z.string() }),
      component: StatusCardComponent,
    });
  }
}
