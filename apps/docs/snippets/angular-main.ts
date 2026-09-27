import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { CopilotChatComponent, provideCopilot } from '@gixcopilot/angular';

@Component({
  selector: 'app-root',
  imports: [CopilotChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<aicopilot-chat label="Copilot" />',
})
class AppComponent {}

await bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection(), provideCopilot({ endpoint: '/api/copilot' })],
});
