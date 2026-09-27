import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CopilotService, provideCopilot } from '@gixcopilot/angular';
import { AppComponent } from './app/app.component.js';
import { DEMO_ANSWER, createDemoServer } from './backend.js';

const servers: ReturnType<typeof createDemoServer>[] = [];
afterEach(async () => {
  TestBed.resetTestingModule();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Angular UI → @gixcopilot/angular → client → HTTP/SSE → server → model runtime → mock provider', () => {
  it('streams a real answer into the Angular chat and sends registered context and tools', async () => {
    const server = createDemoServer({ delayMsPerChunk: 5 });
    servers.push(server);
    const url = await server.listen({ host: '127.0.0.1', port: 0 });

    TestBed.configureTestingModule({ providers: [provideCopilot({ endpoint: url })] });
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const copilot = TestBed.inject(CopilotService);
    const root = fixture.nativeElement as HTMLElement;

    expect(copilot.parts.registry.get('current-page')).toBeDefined();
    expect(copilot.parts.toolRegistry.get('navigation.openApplication')).toBeDefined();

    const textarea = root.querySelector('textarea');
    const form = root.querySelector('form');
    if (!textarea || !form) throw new Error('chat did not render');
    textarea.value = 'What is this app?';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await until(() => copilot.status() === 'streaming' || copilot.status() === 'completed');
    await until(() => copilot.status() === 'completed');
    await fixture.whenStable();
    expect(root.querySelector('[role="log"]')?.textContent).toContain(DEMO_ANSWER);
    expect(copilot.state().usage).toBeDefined();
  });
});
