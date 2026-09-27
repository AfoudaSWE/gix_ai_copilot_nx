import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideCopilot } from '@gixcopilot/angular';
import { AppComponent } from './app/app.component.js';

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection(), provideCopilot({ endpoint: '/api/copilot' })],
}).catch((error: unknown) => console.error(error));
