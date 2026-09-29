import { readFile } from 'node:fs/promises';
import type { ModelRuntime } from '@gixcopilot/provider';
import type { ToolSecurityManifest } from '@gixcopilot/protocol';
import { createApplyEngine } from './apply/engine.js';
import type { ApplyEngine, CommandRunner, ValidationStep } from './apply/engine.js';
import { unifiedDiff } from './apply/diff.js';
import { createModelSettingsStore } from './configuration/model-settings.js';
import type { ConnectionTestResult, ModelSettingsStore, ProviderFactory } from './configuration/model-settings.js';
import { redactConfig } from './configuration/redact.js';
import { computeDiagnostics } from './diagnostics.js';
import type { RuntimeFacts, StudioDiagnostics } from './diagnostics.js';
import { discoverProject } from './discovery/discover.js';
import type { DiscoverProjectOptions } from './discovery/discover.js';
import type { DiscoveredProject } from './discovery/model.js';
import { compareDiscoveries } from './discovery/rescan.js';
import type { DiscoveryComparison } from './discovery/rescan.js';
import { apiToolsGenerator, openApiToolsGenerator } from './generators/api-tools.js';
import { contextGenerator, generativeUiGenerator, securityPolicyGenerator } from './generators/application-generators.js';
import type { AnyGenerator, GeneratorInput } from './generators/contract.js';
import { buildProposal, runGenerator } from './generators/pipeline.js';
import { agentGenerator, configurationGenerator, COPILOT_CONFIG_FILE, knowledgeGenerator, skillGenerator } from './generators/project-generators.js';
import { applyEdits } from './proposals/edit.js';
import type { ChangeProposal, ProposalItems, ProposalWarning } from './proposals/model.js';
import { assertTransition, createProposalStore } from './proposals/store.js';
import { createReadonlyWorkspace } from './workspace/workspace.js';
import type { ReadonlyWorkspace, WorkspaceLimits } from './workspace/workspace.js';

export const DEFAULT_GENERATORS: readonly AnyGenerator[] = [
  apiToolsGenerator,
  openApiToolsGenerator,
  contextGenerator,
  generativeUiGenerator,
  securityPolicyGenerator,
  agentGenerator,
  skillGenerator,
  knowledgeGenerator,
  configurationGenerator,
] as AnyGenerator[];

/** A tool as the host's registry lists it: only what the Studio shows (§11). */
export interface HostToolView {
  readonly name: string;
  readonly security?: ToolSecurityManifest;
}

export interface StudioServiceOptions {
  /** The application workspace root. Discovery and apply never leave it (§54). */
  readonly root: string;
  readonly limits?: Partial<WorkspaceLimits>;
  readonly generators?: readonly AnyGenerator[];
  readonly model?: { readonly provider: string; readonly model: string };
  readonly providers?: Readonly<Record<string, ProviderFactory>>;
  readonly keyEnvironment?: Readonly<Record<string, string>>;
  readonly modelRuntime?: ModelRuntime;
  /** Facts about the running integration (firewall configured, DevTools enabled, ...). */
  readonly facts?: () => Omit<RuntimeFacts, 'lastConnection'>;
  /** The host's application tools, for the Security view and the plane check (§11, §72). */
  readonly tools?: () => readonly HostToolView[];
  /** Resolved configuration layers from the host (§63). Redacted before display. */
  readonly configLayers?: () => Readonly<Partial<Record<'default' | 'project' | 'environment' | 'runtime', unknown>>>;
  readonly security?: () => SecuritySummary;
  readonly validationSteps?: readonly ValidationStep[];
  readonly commandRunner?: CommandRunner;
  readonly discovery?: Pick<DiscoverProjectOptions, 'detectors' | 'maxKnowledgeSources'>;
}

/** What the Security view shows; always a description of the existing @gixcopilot/security setup. */
export interface SecuritySummary {
  readonly firewall: boolean;
  readonly defaultPolicy?: string;
  readonly approvalPolicy?: string;
  readonly piiProtection?: boolean;
  readonly audit?: boolean;
}

export class StudioNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudioNotFoundError';
  }
}

export interface ProposalView extends ChangeProposal {
  /** Unified diff per file, against the file as it is now (§48). */
  readonly diffs: readonly { readonly path: string; readonly kind: string; readonly diff: string }[];
}

export interface StudioService {
  readonly workspace: ReadonlyWorkspace;
  status(): StudioStatus;
  discover(signal?: AbortSignal): Promise<DiscoveredProject>;
  latestDiscovery(): DiscoveredProject | undefined;
  rescan(signal?: AbortSignal): Promise<{ readonly discovery: DiscoveredProject; readonly comparison?: DiscoveryComparison }>;
  sync(signal?: AbortSignal): Promise<{ readonly comparison?: DiscoveryComparison; readonly proposals: readonly ChangeProposal[] }>;
  generators(): readonly { readonly id: string; readonly title: string; readonly description: string }[];
  generate(generatorId: string, input?: GeneratorInput, signal?: AbortSignal): Promise<ChangeProposal>;
  proposals(): readonly ChangeProposal[];
  proposal(id: string): Promise<ProposalView>;
  edit(id: string, edits: readonly unknown[]): Promise<ChangeProposal>;
  approve(id: string, selection?: readonly string[]): Promise<ChangeProposal>;
  reject(id: string): ChangeProposal;
  apply(id: string, signal?: AbortSignal): Promise<ChangeProposal>;
  rollback(id: string): Promise<{ readonly restored: readonly string[]; readonly skipped: readonly string[] }>;
  diagnostics(): StudioDiagnostics;
  model: ModelSettingsStore;
  testConnection(signal?: AbortSignal): Promise<ConnectionTestResult>;
  config(): Promise<StudioConfigView>;
}

export interface StudioStatus {
  readonly project: string;
  readonly environment: string;
  readonly model: ReturnType<ModelSettingsStore['get']>;
  readonly discovered: boolean;
  readonly pendingProposals: number;
  readonly stage: StudioDiagnostics['stage'];
}

export interface StudioConfigView {
  readonly layers: Readonly<Record<string, unknown>>;
  readonly copilot: unknown;
  readonly security: SecuritySummary & { readonly toolPolicies: readonly HostToolView[] };
}

/** Every item id in a proposal, for turning a selection list into `selected` flags (§49). */
function withSelection(items: ProposalItems, selection: readonly string[]): ProposalItems {
  const chosen = new Set(selection);
  const mark = <T extends { readonly id: string; readonly selected: boolean }>(list: readonly T[]): T[] => list.map((item) => ({ ...item, selected: chosen.has(item.id) }));
  const tools = mark(items.tools);
  return {
    tools,
    // Policy candidates follow their tool; standalone policies follow the selection.
    policies: items.policies.map((policy) => {
      const tool = tools.find((candidate) => `policy:${candidate.id}` === policy.id);
      return { ...policy, selected: tool ? tool.selected : chosen.has(policy.id) };
    }),
    context: mark(items.context),
    ui: mark(items.ui),
    agents: mark(items.agents),
    skills: mark(items.skills),
    knowledge: mark(items.knowledge),
    configChanges: mark(items.configChanges),
  };
}

const itemsOf = (proposal: ChangeProposal): ProposalItems => ({ tools: proposal.tools, context: proposal.context, ui: proposal.ui, agents: proposal.agents, skills: proposal.skills, knowledge: proposal.knowledge, policies: proposal.policies, configChanges: proposal.configChanges });

/**
 * The Studio's framework-independent core. The HTTP plugin is a thin layer over it, so every
 * guarantee (read-only discovery, generate/apply separation, approval gate) holds for any
 * transport and is testable without one.
 */
export function createStudioService(options: StudioServiceOptions): StudioService {
  const workspace = createReadonlyWorkspace(options.root, options.limits);
  const generators = new Map((options.generators ?? DEFAULT_GENERATORS).map((generator) => [generator.id, generator]));
  const store = createProposalStore();
  const generatorWarnings = new Map<string, readonly ProposalWarning[]>();
  const model = createModelSettingsStore({ ...(options.model ? { initial: options.model } : {}), ...(options.providers ? { providers: options.providers } : {}), ...(options.modelRuntime ? { runtime: options.modelRuntime } : {}), ...(options.keyEnvironment ? { keyEnvironment: options.keyEnvironment } : {}) });
  let discovery: DiscoveredProject | undefined;
  let lastConnection: RuntimeFacts['lastConnection'];
  const engine: ApplyEngine = createApplyEngine({
    guard: workspace.guard,
    commands: () => discovery?.commands ?? {},
    ...(options.validationSteps ? { validationSteps: options.validationSteps } : {}),
    ...(options.commandRunner ? { runner: options.commandRunner } : {}),
  });

  const getProposal = (id: string): ChangeProposal => {
    const proposal = store.get(id);
    if (!proposal) throw new StudioNotFoundError(`No proposal "${id}".`);
    return proposal;
  };
  const generatorOf = (proposal: ChangeProposal): AnyGenerator => {
    const generator = generators.get(proposal.generator);
    if (!generator) throw new StudioNotFoundError(`Generator "${proposal.generator}" is not registered.`);
    return generator;
  };
  const ensureDiscovery = async (signal?: AbortSignal): Promise<DiscoveredProject> => discovery ?? service.discover(signal);
  const rebuild = (proposal: ChangeProposal, items: ProposalItems): Promise<ChangeProposal> =>
    buildProposal(generatorOf(proposal), workspace, { id: proposal.id, title: proposal.title, createdAt: proposal.createdAt, diagnostics: proposal.diagnostics, generatorWarnings: generatorWarnings.get(proposal.id) ?? [] }, items, proposal.fileChanges);

  const service: StudioService = {
    workspace,
    model,
    status() {
      return {
        project: discovery?.workspace.name ?? workspace.root.split(/[\\/]/).pop() ?? 'workspace',
        environment: process.env['NODE_ENV'] ?? 'development',
        model: model.get(),
        discovered: discovery !== undefined,
        pendingProposals: store.list().filter((proposal) => proposal.status === 'draft' || proposal.status === 'ready-for-review').length,
        stage: service.diagnostics().stage,
      };
    },
    async discover(signal) {
      const result = await discoverProject(workspace, { ...options.discovery, ...(signal ? { signal } : {}) });
      discovery = result;
      return result;
    },
    latestDiscovery: () => discovery,
    async rescan(signal) {
      const before = discovery;
      const current = await service.discover(signal);
      return { discovery: current, ...(before ? { comparison: compareDiscoveries(before, current) } : {}) };
    },
    async sync(signal) {
      // Re-scan → compare → recommend → preview (§62). Proposals only; nothing is written.
      const { comparison } = await service.rescan(signal);
      const proposals: ChangeProposal[] = [];
      if (comparison && comparison.unchanged) return { comparison, proposals };
      const changedOperations = comparison ? [...comparison.newApis, ...comparison.changedApis] : undefined;
      for (const generator of [apiToolsGenerator, openApiToolsGenerator]) {
        const kinds = generator === openApiToolsGenerator ? ['openapi'] : ['backend-route', 'frontend-client'];
        const select = changedOperations?.filter((operation) => kinds.includes(operation.sourceKind)).map((operation) => `${operation.method} ${operation.path}`);
        if (select && select.length === 0) continue;
        const proposal = await service.generate(generator.id, select ? { select } : {}, signal);
        if (proposal.tools.length > 0) proposals.push(proposal);
      }
      if (!comparison || comparison.newComponents.length + comparison.changedComponents.length > 0) {
        const select = comparison ? [...comparison.newComponents, ...comparison.changedComponents].map((component) => component.name) : undefined;
        const proposal = await service.generate(generativeUiGenerator.id, select ? { select } : {}, signal);
        if (proposal.ui.length > 0) proposals.push(proposal);
      }
      if (!comparison || comparison.newContextCandidates.length > 0) {
        const select = comparison?.newContextCandidates.map((candidate) => candidate.name);
        const proposal = await service.generate(contextGenerator.id, select ? { select } : {}, signal);
        if (proposal.context.length > 0) proposals.push(proposal);
      }
      return { ...(comparison ? { comparison } : {}), proposals };
    },
    generators: () => [...generators.values()].map(({ id, title, description }) => ({ id, title, description })),
    async generate(generatorId, input = {}, signal) {
      const generator = generators.get(generatorId);
      if (!generator) throw new StudioNotFoundError(`No generator "${generatorId}".`);
      const current = await ensureDiscovery(signal);
      const { proposal, generatorWarnings: warnings } = await runGenerator(generator, { workspace, discovery: current, ...(signal ? { signal } : {}) }, input);
      generatorWarnings.set(proposal.id, warnings);
      store.save(proposal);
      return proposal;
    },
    proposals: () => store.list(),
    async proposal(id) {
      const proposal = getProposal(id);
      const diffs = [];
      for (const change of proposal.fileChanges) {
        const current = await workspace.readText(change.path).catch(() => undefined);
        diffs.push({ path: change.path, kind: change.kind, diff: unifiedDiff(change.path, current, change.content) });
      }
      return { ...proposal, diffs };
    },
    async edit(id, edits) {
      const proposal = getProposal(id);
      if (proposal.status !== 'draft' && proposal.status !== 'ready-for-review' && proposal.status !== 'rejected') {
        throw new StudioNotFoundError(`A ${proposal.status} proposal can no longer be edited; generate a new one.`);
      }
      const next = await rebuild(proposal, applyEdits(itemsOf(proposal), edits));
      store.save(next);
      return next;
    },
    async approve(id, selection) {
      // "Approve Selected Changes" is the only transition into an apply operation (§52).
      const proposal = getProposal(id);
      if (proposal.status !== 'draft') assertTransition(proposal.status, 'approved');
      const items = selection ? withSelection(itemsOf(proposal), selection) : itemsOf(proposal);
      // Approval always re-runs the security review on exactly what apply would write.
      const reviewed = await rebuild(proposal, items);
      store.save(reviewed);
      if (reviewed.securityReview.some((finding) => finding.severity === 'error')) {
        throw new StudioApprovalError('The security review has blocking findings; fix them before approving.', reviewed);
      }
      if (reviewed.fileChanges.length === 0) throw new StudioApprovalError('Nothing is selected, so there is nothing to approve.', reviewed);
      const approved: ChangeProposal = { ...reviewed, status: 'approved', updatedAt: new Date().toISOString() };
      store.save(approved);
      return approved;
    },
    reject(id) {
      // Reject All (§51): no repository change; the proposal stays available for editing.
      const proposal = getProposal(id);
      assertTransition(proposal.status, 'rejected');
      const rejected: ChangeProposal = { ...proposal, status: 'rejected', updatedAt: new Date().toISOString() };
      store.save(rejected);
      return rejected;
    },
    async apply(id, signal) {
      const next = await engine.apply(getProposal(id), signal ? { signal } : {});
      store.save(next);
      return next;
    },
    rollback: (id) => engine.rollback(getProposal(id)),
    diagnostics() {
      const facts = { runtime: false, server: false, firewall: false, devtools: false, ...options.facts?.(), ...(lastConnection ? { lastConnection } : {}) };
      return computeDiagnostics({ facts, model: model.get(), ...(discovery ? { discovery } : {}), proposals: store.list() });
    },
    async testConnection(signal) {
      const result = await model.test(signal);
      lastConnection = { success: result.success, latencyMs: result.latencyMs };
      return result;
    },
    async config() {
      let copilot: unknown = {};
      try {
        copilot = JSON.parse(await readFile(workspace.guard.resolve(COPILOT_CONFIG_FILE), 'utf8'));
      } catch {
        copilot = {};
      }
      const security = options.security?.() ?? { firewall: options.facts?.().firewall ?? false };
      return {
        layers: redactConfig(options.configLayers?.() ?? {}) as Record<string, unknown>,
        copilot: redactConfig(copilot),
        security: { ...security, toolPolicies: (options.tools?.() ?? []).map((tool) => ({ name: tool.name, ...(tool.security ? { security: tool.security } : {}) })) },
      };
    },
  };
  return service;
}

export class StudioApprovalError extends Error {
  readonly proposal: ChangeProposal;

  constructor(message: string, proposal: ChangeProposal) {
    super(message);
    this.name = 'StudioApprovalError';
    this.proposal = proposal;
  }
}
