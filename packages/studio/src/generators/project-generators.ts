import type { ApiOperation, KnowledgeCandidate } from '../discovery/model.js';
import { isDevelopmentAgentOrSkill } from '../planes.js';
import type { AgentProposal, ConfigChange, KnowledgeProposal, ProposalWarning, SkillProposal } from '../proposals/model.js';
import { GENERATED_ROOT, header, identifier, slug, str } from './codegen.js';
import type { Generator, RenderedFile } from './contract.js';
import { EMPTY_DRAFT } from './draft.js';
import { suggestRisk, toolNameFor } from './risk.js';

const selectedOnly = <T extends { readonly selected: boolean }>(items: readonly T[]): T[] => items.filter((item) => item.selected);

interface Domain {
  readonly resource: string;
  readonly readTools: readonly string[];
  readonly writeTools: readonly string[];
}

/** Groups discovered operations by their first resource segment, e.g. `/payments/...`. */
function domainsOf(operations: readonly ApiOperation[]): Domain[] {
  const groups = new Map<string, { read: Set<string>; write: Set<string> }>();
  for (const operation of operations) {
    const resource = operation.path.split('/').find((segment) => segment.length > 0 && !/^(api|v\d+)$/i.test(segment) && !segment.startsWith('{') && !segment.startsWith(':'));
    if (!resource) continue;
    const key = slug(resource.replace(/ies$/, 'y').replace(/s$/, ''));
    const group = groups.get(key) ?? { read: new Set<string>(), write: new Set<string>() };
    const risk = suggestRisk(operation.method);
    // Destructive tools are never assigned to a recommended agent by default.
    if (risk === 'read-only') group.read.add(toolNameFor(operation.method, operation.path));
    else if (risk === 'write') group.write.add(toolNameFor(operation.method, operation.path));
    groups.set(key, group);
  }
  return [...groups]
    .filter(([, group]) => group.read.size + group.write.size >= 2)
    .map(([resource, group]) => ({ resource, readTools: [...group.read].sort(), writeTools: [...group.write].sort() }));
}

const title = (value: string): string => value.replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase());

// --- Project → Agents (§40): application-plane agents only ----------------------------------

export const agentGenerator: Generator<readonly Domain[]> = {
  id: 'project-agents',
  title: 'Project → Agents',
  description: 'Recommends application agents, one per API domain, scoped to that domain\'s tools.',
  analyze(context, input) {
    const domains = domainsOf(context.discovery.apis.filter((source) => source.kind !== 'frontend-client').flatMap((source) => source.operations));
    return Promise.resolve(input.select && input.select.length > 0 ? domains.filter((domain) => input.select?.includes(domain.resource)) : domains);
  },
  generate(domains) {
    const agents = domains.map((domain): AgentProposal => {
      const id = `${domain.resource}-assistant`;
      return {
        id: `agent:${id}`,
        selected: true,
        name: id,
        description: `Answers questions and performs ${title(domain.resource).toLowerCase()} tasks.`,
        instructions: `You help users with ${title(domain.resource).toLowerCase()} records. Use only your tools. Never guess identifiers; ask when one is missing.`,
        tools: [...domain.readTools, ...domain.writeTools],
      };
    });
    const warnings: ProposalWarning[] = agents.length === 0 ? [{ code: 'NO_DOMAINS', message: 'No API domain with at least two operations was discovered.' }] : [{ code: 'TOOLS_REQUIRED', message: 'Agents reference tool names; generate and register those tools (API → Tools) before enabling an agent.' }];
    return Promise.resolve({ ...EMPTY_DRAFT, title: `Project → Agents: ${String(agents.length)} recommendation(s)`, warnings, agents });
  },
  render(items) {
    return Promise.resolve(
      selectedOnly(items.agents).map((agent): RenderedFile => ({
        path: `${GENERATED_ROOT}/agents/${slug(agent.name)}.ts`,
        content: `${header('Project → Agents', 'An application-plane agent recommendation.')}import { defineAgent } from '@gixcopilot/agents';

export const ${identifier(agent.name)} = defineAgent({
  id: ${str(slug(agent.name))},
  name: ${str(title(agent.name))},
  description: ${str(agent.description)},
  instructions: ${str(agent.instructions)},
  tools: [${agent.tools.map(str).join(', ')}],
});
`,
        itemIds: [agent.id],
      })),
    );
  },
  validate: (items) =>
    selectedOnly(items.agents)
      .filter((agent) => isDevelopmentAgentOrSkill(slug(agent.name)))
      .map((agent) => ({ code: 'DEVELOPMENT_AGENT_NAME', message: `"${agent.name}" is a development agent id; application agents need their own names.`, itemId: agent.id })),
};

// --- Project → Skills (§41): application-plane skills only ----------------------------------

export const skillGenerator: Generator<readonly Domain[]> = {
  id: 'project-skills',
  title: 'Project → Skills',
  description: 'Recommends application skills: task instructions an application agent can follow.',
  analyze: (context, input) => agentGenerator.analyze(context, input),
  generate(domains) {
    const skills = domains.flatMap((domain): SkillProposal[] => {
      const name = domain.resource;
      const list: SkillProposal[] = [];
      if (domain.readTools.length > 0) {
        list.push({ id: `skill:${name}-search`, selected: true, name: `${name}-search`, description: `Find and summarize ${title(name).toLowerCase()} records.`, tools: domain.readTools, steps: ['Clarify what the user is looking for.', `Use ${domain.readTools.join(', ')} to look it up.`, 'Summarize the result and cite the record identifiers.'] });
      }
      if (domain.writeTools.length > 0) {
        list.push({ id: `skill:${name}-management`, selected: false, name: `${name}-management`, description: `Create or update ${title(name).toLowerCase()} records with confirmation.`, tools: domain.writeTools, steps: ['Collect every required field from the user.', 'Show the change and ask for confirmation.', `Call ${domain.writeTools.join(', ')}; the Action Firewall may still require approval.`] });
      }
      return list;
    });
    return Promise.resolve({ ...EMPTY_DRAFT, title: `Project → Skills: ${String(skills.length)} recommendation(s)`, skills });
  },
  render(items) {
    return Promise.resolve(
      selectedOnly(items.skills).map((skill): RenderedFile => ({
        path: `${GENERATED_ROOT}/skills/${slug(skill.name)}.md`,
        content: `---\nname: ${slug(skill.name)}\ndescription: ${skill.description}\nplane: application\ntools: [${skill.tools.join(', ')}]\n---\n\n<!-- Generated by GIX Developer Studio (Project → Skills). An application skill: add it to an application agent's instructions. -->\n\n# ${title(skill.name)}\n\n${skill.steps.map((step, index) => `${String(index + 1)}. ${step}`).join('\n')}\n`,
        itemIds: [skill.id],
      })),
    );
  },
  validate: (items) =>
    selectedOnly(items.skills)
      .filter((skill) => isDevelopmentAgentOrSkill(slug(skill.name)))
      .map((skill) => ({ code: 'DEVELOPMENT_SKILL_NAME', message: `"${skill.name}" is a development skill id; application skills need their own names.`, itemId: skill.id })),
};

// --- Docs → Knowledge (§42) ---------------------------------------------------------------

function knowledgeGroup(candidate: KnowledgeCandidate): string {
  const docs = /(?:^|\/)docs?\/([^/]+)\//i.exec(candidate.path);
  if (docs?.[1]) return docs[1];
  return candidate.kind === 'openapi' ? 'api' : 'project';
}

export const knowledgeGenerator: Generator<readonly KnowledgeCandidate[]> = {
  id: 'docs-knowledge',
  title: 'Docs → Knowledge',
  description: 'Groups documentation into knowledge sources. Nothing is indexed until your code indexes it.',
  analyze(context, input) {
    const all = context.discovery.knowledgeSources.filter((candidate) => candidate.kind !== 'openapi');
    return Promise.resolve(input.select && input.select.length > 0 ? all.filter((candidate) => input.select?.includes(candidate.path)) : all);
  },
  generate(candidates) {
    const groups = new Map<string, KnowledgeCandidate[]>();
    for (const candidate of candidates) groups.set(knowledgeGroup(candidate), [...(groups.get(knowledgeGroup(candidate)) ?? []), candidate]);
    const knowledge = [...groups].map(([group, sources]): KnowledgeProposal => ({
      id: `knowledge:${slug(group)}`,
      // The developer chooses what becomes knowledge (§23, §42): nothing is preselected.
      selected: false,
      name: `${title(slug(group))} Knowledge`,
      description: `${String(sources.length)} document(s) under ${group}.`,
      sources: sources.map((source) => ({ path: source.path, kind: source.kind })),
    }));
    return Promise.resolve({ ...EMPTY_DRAFT, title: `Docs → Knowledge: ${String(knowledge.length)} group(s)`, knowledge });
  },
  render(items) {
    const selected = selectedOnly(items.knowledge);
    if (selected.length === 0) return Promise.resolve([]);
    const helper = (kind: string): string => (kind === 'pdf' ? 'pdfSource' : kind === 'docx' ? 'docxSource' : 'fileSource');
    const used = [...new Set(selected.flatMap((group) => group.sources.map((source) => helper(source.kind))))].sort();
    const blocks = selected.map((group) => {
      const sources = group.sources.map((source) => `  ${helper(source.kind)}({ id: ${str(slug(source.path))}, name: ${str(source.path)}, path: at(${str(source.path)}), metadata: { group: ${str(group.name)} } }),`);
      return `/** ${group.description} */\nexport const ${identifier(group.name)} = [\n${sources.join('\n')}\n];`;
    });
    const content = `${header('Docs → Knowledge', 'Reviewed sources. Nothing is indexed until you pass them to your indexer.')}import { fileURLToPath } from 'node:url';
import { ${used.join(', ')} } from '@gixcopilot/knowledge';

const at = (path: string): string => fileURLToPath(new URL(\`../../\${path}\`, import.meta.url));

${blocks.join('\n\n')}
`;
    return Promise.resolve([{ path: `${GENERATED_ROOT}/knowledge/sources.ts`, content, itemIds: selected.map((group) => group.id) }]);
  },
  validate: () => [],
};

// --- Studio configuration (§7, §10, §63): saved as a reviewed proposal ----------------------

export const COPILOT_CONFIG_FILE = `${GENERATED_ROOT}/copilot.config.json`;

function setPath(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    node[part] = typeof next === 'object' && next !== null && !Array.isArray(next) ? next : {};
    node = node[part] as Record<string, unknown>;
  }
  const last = parts.at(-1);
  if (last) node[last] = value;
}

function getPath(source: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), source);
}

async function readConfig(context: Parameters<Generator['render']>[1]): Promise<Record<string, unknown>> {
  const text = await context.workspace.readText(COPILOT_CONFIG_FILE);
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Values arrive already validated by the Studio API's schema (`values` = flat dot-path map). */
export const configurationGenerator: Generator<{ readonly values: Readonly<Record<string, unknown>>; readonly current: Record<string, unknown> }> = {
  id: 'studio-configuration',
  title: 'Copilot configuration',
  description: 'Saves Appearance and Copilot settings to .gix/copilot.config.json through review.',
  async analyze(context, input) {
    return { values: input.values ?? {}, current: await readConfig(context) };
  },
  generate({ values, current }) {
    const configChanges = Object.entries(values)
      .filter(([key, value]) => JSON.stringify(getPath(current, key)) !== JSON.stringify(value))
      .map(([key, value]): ConfigChange => ({ id: `config:${key}`, selected: true, file: COPILOT_CONFIG_FILE, key, ...(getPath(current, key) !== undefined ? { before: getPath(current, key) } : {}), after: value }));
    return Promise.resolve({ ...EMPTY_DRAFT, title: `Configuration: ${String(configChanges.length)} change(s)`, configChanges });
  },
  async render(items, context) {
    const selected = selectedOnly(items.configChanges);
    if (selected.length === 0) return [];
    const config = await readConfig(context);
    for (const change of selected) setPath(config, change.key, change.after);
    return [{ path: COPILOT_CONFIG_FILE, content: `${JSON.stringify(config, null, 2)}\n`, itemIds: selected.map((change) => change.id) }];
  },
  validate: () => [],
};
