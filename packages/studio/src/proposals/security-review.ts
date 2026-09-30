import { isValidToolName } from '@gixcopilot/tools';
import { scanForSecrets } from '../apply/secret-scan.js';
import { GENERATED_ROOT } from '../generators/codegen.js';
import { approvalFloor, isRiskLowered, meetsApprovalFloor } from '../generators/risk.js';
import { isDevelopmentAgentOrSkill, isDevelopmentToolName } from '../planes.js';
import type { FileChange, ProposalItems, SecurityFinding } from './model.js';

/**
 * The security review every proposal passes before it can be approved (§31, §50). An
 * `error` blocks approval; UI edits cannot get around it because approval re-runs it.
 */
export function reviewProposalSecurity(items: ProposalItems, files: readonly FileChange[], allowedPaths?: (path: string, items: ProposalItems) => boolean): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const tools = items.tools.filter((tool) => tool.selected);
  const seen = new Map<string, string>();
  for (const tool of tools) {
    if (!isValidToolName(tool.name)) findings.push({ severity: 'error', code: 'INVALID_TOOL_NAME', message: `"${tool.name}" is not a valid tool name (dot-separated camelCase segments).`, itemId: tool.id });
    if (isDevelopmentToolName(tool.name)) findings.push({ severity: 'error', code: 'DEVELOPMENT_PLANE_NAME', message: `"${tool.name}" uses a development-plane namespace and cannot be an application tool (ADR 0023).`, itemId: tool.id });
    const duplicate = seen.get(tool.name);
    if (duplicate) findings.push({ severity: 'error', code: 'DUPLICATE_TOOL_NAME', message: `"${tool.name}" is used by more than one tool.`, itemId: tool.id });
    seen.set(tool.name, tool.id);
    if (!meetsApprovalFloor(tool.risk, tool.approval)) {
      findings.push({ severity: 'error', code: 'APPROVAL_BELOW_POLICY', message: `${tool.name}: a ${tool.risk} tool needs at least "${approvalFloor(tool.risk)}" approval; "${tool.approval}" was chosen.`, itemId: tool.id });
    }
    if (tool.risk === 'destructive' && tool.enabled && !tool.permission) {
      findings.push({ severity: 'error', code: 'DESTRUCTIVE_WITHOUT_PERMISSION', message: `${tool.name} is destructive and enabled but requires no permission.`, itemId: tool.id });
    } else if (tool.risk !== 'read-only' && !tool.permission) {
      findings.push({ severity: 'warning', code: 'WRITE_WITHOUT_PERMISSION', message: `${tool.name} changes data but requires no permission.`, itemId: tool.id });
    }
    if (isRiskLowered(tool.suggestedRisk, tool.risk)) {
      findings.push({ severity: 'warning', code: 'RISK_LOWERED', message: `${tool.name}: risk lowered from "${tool.suggestedRisk}" (${tool.operation.method}) to "${tool.risk}". Confirm the operation really has no side effects.`, itemId: tool.id });
    }
    if (tool.risk === 'destructive' && tool.enabled) findings.push({ severity: 'warning', code: 'DESTRUCTIVE_ENABLED', message: `${tool.name} is destructive and will be enabled.`, itemId: tool.id });
  }
  for (const item of [...items.agents, ...items.skills].filter((entry) => entry.selected)) {
    if (isDevelopmentAgentOrSkill(item.name)) findings.push({ severity: 'error', code: 'DEVELOPMENT_PLANE_NAME', message: `"${item.name}" is a development agent/skill id (ADR 0023).`, itemId: item.id });
  }
  for (const agent of items.agents.filter((entry) => entry.selected)) {
    const development = agent.tools.filter(isDevelopmentToolName);
    if (development.length > 0) findings.push({ severity: 'error', code: 'DEVELOPMENT_TOOL_ASSIGNED', message: `${agent.name} references development tools: ${development.join(', ')}.`, itemId: agent.id });
  }
  for (const file of files) {
    if (!file.path.startsWith(`${GENERATED_ROOT}/`)) {
      if (!allowedPaths?.(file.path, items)) {
        findings.push({ severity: 'error', code: 'OUTSIDE_GENERATED_ROOT', message: `This generator may only write under ${GENERATED_ROOT}/.`, path: file.path });
      } else if (file.kind !== 'create') {
        // Editing existing application source is allowed only for declared files, and always shown.
        findings.push({ severity: 'warning', code: 'MODIFIES_APPLICATION_SOURCE', message: `Changes your existing file ${file.path}; review the diff.`, path: file.path });
      }
    }
    for (const secret of scanForSecrets(file.content ?? '')) {
      findings.push({ severity: 'error', code: 'SECRET_IN_OUTPUT', message: `Possible ${secret.kind} at line ${String(secret.line)}. Secrets never go into generated code.`, path: file.path });
    }
  }
  return findings;
}
