import { join } from 'node:path';
import type { Framework, PackageManager, ProjectInfo } from './detect.js';
import { ANGULAR_PROXY, ANGULAR_PROXY_FILE, API_PREFIX, SERVER_URL, VITE_PROXY_SNIPPET, patchAngularJson, patchScripts, patchViteConfig } from './patch.js';
import type { PatchResult } from './patch.js';

export const VERSION = '0.2.1';

export interface Choices {
  /** Frontend to integrate; undefined means server only. */
  readonly framework?: Framework;
  readonly server: boolean;
  readonly serverDir: string;
  readonly packageManager: PackageManager;
  readonly install: boolean;
}

export type Step =
  | { readonly kind: 'command'; readonly label: string; readonly cwd: string; readonly command: string; readonly args: readonly string[]; readonly env?: Readonly<Record<string, string>> }
  | { readonly kind: 'write'; readonly label: string; readonly path: string; readonly content: string }
  | { readonly kind: 'copy'; readonly label: string; readonly from: string; readonly to: string }
  | { readonly kind: 'patch'; readonly label: string; readonly path: string; readonly apply: (source: string) => PatchResult; readonly manual: string };

export interface Plan {
  readonly steps: readonly Step[];
  readonly next: readonly string[];
}

const PACKAGES: Readonly<Record<Framework, readonly string[]>> = {
  react: ['@gixcopilot/react', '@gixcopilot/ui'],
  vue: ['@gixcopilot/vue'],
  angular: ['@gixcopilot/angular', 'zod'],
};

function addArgs(manager: PackageManager, packages: readonly string[]): string[] {
  return [manager === 'npm' ? 'install' : 'add', ...packages];
}

function runScript(manager: PackageManager, dir: string, script: string): string {
  switch (manager) {
    case 'npm':
      return `npm --prefix ${dir} run ${script}`;
    case 'pnpm':
      return `pnpm --dir ${dir} run ${script}`;
    case 'yarn':
      return `yarn --cwd ${dir} ${script}`;
    case 'bun':
      return `bun --cwd ${dir} run ${script}`;
  }
}

const run = (manager: PackageManager, script: string): string => (manager === 'npm' || manager === 'bun' ? `${manager} run ${script}` : `${manager} ${script}`);

/** The command that scaffolds a brand-new app before the copilot is added to it. */
export function newProjectStep(kind: Framework | 'node', name: string, parent: string): Step {
  switch (kind) {
    case 'react':
    case 'vue':
      return { kind: 'command', label: `Create a ${kind} app with Vite`, cwd: parent, command: 'npm', args: ['create', 'vite@latest', name, '--', '--template', `${kind}-ts`, '--no-interactive'] };
    case 'angular':
      // Pinned to the Angular major @gixcopilot/angular supports.
      return { kind: 'command', label: 'Create an Angular app', cwd: parent, command: 'npx', args: ['-y', '@angular/cli@21', 'new', name, '--defaults', '--skip-git', '--skip-install', '--ssr=false'], env: { NG_CLI_ANALYTICS: 'false' } };
    case 'node':
      return { kind: 'command', label: 'Create a Node copilot server', cwd: parent, command: 'npx', args: ['-y', `@gixcopilot/cli@${VERSION}`, 'init', name, '--template', 'node', '--name', name] };
  }
}

function reactPanel(): string {
  return `'use client';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';

/** The copilot chat. The browser only calls ${API_PREFIX}; the model key stays on the server. */
export function CopilotPanel() {
  return (
    <CopilotProvider runtimeUrl="${API_PREFIX}">
      <CopilotChat />
    </CopilotProvider>
  );
}
`;
}

function vuePanel(typescript: boolean): string {
  return `<script setup${typescript ? ' lang="ts"' : ''}>
// The copilot chat. The browser only calls ${API_PREFIX}; the model key stays on the server.
import { CopilotChat, provideCopilot } from '@gixcopilot/vue';
import '@gixcopilot/vue/styles.css';

provideCopilot({ endpoint: '${API_PREFIX}' });
</script>

<template>
  <CopilotChat label="Copilot" />
</template>
`;
}

const ANGULAR_PANEL = `import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CopilotChatComponent, provideCopilot } from '@gixcopilot/angular';

/** The copilot chat. The browser only calls ${API_PREFIX}; the model key stays on the server. */
@Component({
  selector: 'app-copilot-panel',
  imports: [CopilotChatComponent],
  providers: [provideCopilot({ endpoint: '${API_PREFIX}' })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<aicopilot-chat label="Copilot" />',
})
export class CopilotPanelComponent {}
`;

function frontendSteps(project: ProjectInfo, framework: Framework, choices: Choices): { steps: Step[]; next: string[] } {
  const { root, typescript, srcDir } = project;
  const steps: Step[] = [];
  const next: string[] = [];
  if (choices.install) {
    steps.push({ kind: 'command', label: `Install ${PACKAGES[framework].join(', ')}`, cwd: root, command: choices.packageManager, args: addArgs(choices.packageManager, PACKAGES[framework]) });
  }
  switch (framework) {
    case 'react': {
      const file = `${srcDir}/copilot/CopilotPanel.${typescript ? 'tsx' : 'jsx'}`;
      steps.push({ kind: 'write', label: `Add ${file}`, path: join(root, file), content: reactPanel() });
      next.push(`Render it: import { CopilotPanel } from './copilot/CopilotPanel'; then <CopilotPanel />`);
      break;
    }
    case 'vue': {
      const file = `${srcDir}/copilot/CopilotPanel.vue`;
      steps.push({ kind: 'write', label: `Add ${file}`, path: join(root, file), content: vuePanel(typescript) });
      next.push(`Render it: import CopilotPanel from './copilot/CopilotPanel.vue'; then <CopilotPanel />`);
      break;
    }
    case 'angular': {
      const file = 'src/app/copilot-panel.component.ts';
      steps.push({ kind: 'write', label: `Add ${file}`, path: join(root, file), content: ANGULAR_PANEL });
      next.push(`Render it: add CopilotPanelComponent (./copilot-panel.component) to a component's imports, then <app-copilot-panel />`);
      break;
    }
  }

  // Dev proxy: the app calls /api/copilot, the dev server forwards it to the copilot server.
  if (framework === 'angular') {
    steps.push({ kind: 'write', label: `Add ${ANGULAR_PROXY_FILE} (dev proxy to ${SERVER_URL})`, path: join(root, ANGULAR_PROXY_FILE), content: ANGULAR_PROXY });
    if (project.angularJson) {
      steps.push({ kind: 'patch', label: 'Use the proxy in "ng serve" (angular.json)', path: join(root, 'angular.json'), apply: patchAngularJson, manual: `Set "proxyConfig": "${ANGULAR_PROXY_FILE}" under architect.serve.options in angular.json.` });
    }
  } else if (project.next) {
    next.push(`Proxy ${API_PREFIX} in next.config: async rewrites() { return [{ source: '${API_PREFIX}/:path*', destination: '${SERVER_URL}/:path*' }]; }`);
  } else if (project.viteConfig) {
    steps.push({ kind: 'patch', label: `Proxy ${API_PREFIX} to the copilot server (${project.viteConfig})`, path: join(root, project.viteConfig), apply: patchViteConfig, manual: `Add to defineConfig in ${project.viteConfig}:\n    ${VITE_PROXY_SNIPPET}` });
  } else {
    next.push(`Forward ${API_PREFIX}/* to ${SERVER_URL}/* in your dev server (or serve both from one origin).`);
  }
  return { steps, next };
}

function serverSteps(project: ProjectInfo, choices: Choices): { steps: Step[]; next: string[] } {
  const dir = join(project.root, choices.serverDir);
  const steps: Step[] = [
    { kind: 'command', label: `Create the Node copilot server in ${choices.serverDir}/`, cwd: project.root, command: 'npx', args: ['-y', `@gixcopilot/cli@${VERSION}`, 'init', choices.serverDir, '--template', 'node', '--name', `${project.name.replace(/^@[^/]+\//, '')}-copilot-server`] },
    { kind: 'copy', label: `Create ${choices.serverDir}/.env (add OPENAI_API_KEY there)`, from: join(dir, '.env.example'), to: join(dir, '.env') },
  ];
  if (choices.install) {
    steps.push({ kind: 'command', label: `Install the server's dependencies`, cwd: dir, command: choices.packageManager, args: choices.packageManager === 'pnpm' ? ['install', '--ignore-workspace'] : ['install'] });
  }
  steps.push({ kind: 'patch', label: 'Add the "copilot:server" script to package.json', path: join(project.root, 'package.json'), apply: (source) => patchScripts(source, { 'copilot:server': runScript(choices.packageManager, choices.serverDir, 'dev') }), manual: `Start the server with: ${runScript(choices.packageManager, choices.serverDir, 'dev')}` });
  return {
    steps,
    next: [
      `Start the copilot server: ${run(choices.packageManager, 'copilot:server')}   (${SERVER_URL})`,
      `Real answers: put OPENAI_API_KEY in ${choices.serverDir}/.env (without it a labelled mock model answers).`,
      `Give it abilities: cd ${choices.serverDir} && npx aicopilot add tool orders-get`,
    ],
  };
}

/** Everything the installer will do for an existing project, in order. Pure: nothing runs here. */
export function planProject(project: ProjectInfo, choices: Choices): Plan {
  const steps: Step[] = [];
  const next: string[] = [];
  if (choices.framework) {
    const frontend = frontendSteps(project, choices.framework, choices);
    steps.push(...frontend.steps);
    next.push(...frontend.next);
  }
  if (choices.server) {
    const server = serverSteps(project, choices);
    steps.push(...server.steps);
    next.unshift(...server.next.slice(0, 1));
    next.push(...server.next.slice(1));
  }
  if (choices.framework) next.splice(choices.server ? 1 : 0, 0, `Start your app: ${run(choices.packageManager, choices.framework === 'angular' ? 'start' : 'dev')}`);
  if (!choices.server && choices.framework) next.push(`Point it at a copilot server that serves ${API_PREFIX} (e.g. npm create @gixcopilot -- --server).`);
  return { steps, next };
}
