import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { GixArchitectureNode, Tabs } from '../design/components.js';
import { Icon } from '../design/icons.js';
import type { IconName } from '../design/icons.js';

/**
 * Interactive product visualizations. They replay observable runtime events (the protocol's
 * real event names), are clearly labelled as scripted demos, never show hidden reasoning, and
 * render their final state immediately for reduced motion or before JavaScript runs.
 */
export function useSequence(total: number, stepMs = 900): { step: number; replay: () => void; ref: RefObject<HTMLDivElement | null>; playing: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(total);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    if (!element || reduce || typeof IntersectionObserver === 'undefined') {
      setStep(total);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = (): void => {
      setPlaying(true);
      setStep(0);
      const advance = (value: number): void => {
        timer = setTimeout(() => {
          setStep(value);
          if (value < total) advance(value + 1);
          else setPlaying(false);
        }, stepMs);
      };
      advance(1);
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [total, stepMs, run]);
  const replay = useCallback(() => setRun((value) => value + 1), []);
  return { step, replay, ref, playing };
}

function DemoLabel({ children = 'Interactive demo · scripted runtime events' }: { readonly children?: ReactNode }) {
  return <span className="demo-label">{children}</span>;
}

/* --------------------------------------------------------------------------- Hero demo */

const HERO_EVENTS: readonly { readonly label: string; readonly event: string; readonly icon: IconName }[] = [
  { label: 'User message', event: 'run.started', icon: 'user' },
  { label: 'Context attached', event: 'context: selected application', icon: 'eye' },
  { label: 'Tool requested', event: 'tool.requested · applications.get', icon: 'tool' },
  { label: 'Security checked', event: 'Action Firewall · allow (read-only)', icon: 'shieldCheck' },
  { label: 'Tool executed', event: 'tool.completed', icon: 'check' },
  { label: 'UI generated', event: 'ApplicationCard · props validated', icon: 'layout' },
  { label: 'Response streamed', event: 'message.delta → run.completed', icon: 'chat' },
];

export function HeroDemo() {
  const { step, replay, ref, playing } = useSequence(HERO_EVENTS.length, 850);
  return (
    <div className="hero-demo" ref={ref}>
      <div className="hero-demo__window" aria-label="Copilot demo conversation" role="group">
        <div className="hero-demo__bar">
          <span className="gix-code__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>AI Copilot</span>
          <DemoLabel>Demo</DemoLabel>
        </div>
        <div className="hero-demo__chat" aria-live="off">
          <div className="bubble bubble--user">Show me the selected application.</div>
          {step >= 2 && (
            <div className="context-chip">
              <Icon name="eye" size={13} /> Context: selected application <code>APP-1024</code>
            </div>
          )}
          {step >= 3 && (
            <div className="tool-chip" data-state={step >= 5 ? 'done' : step >= 4 ? 'checked' : 'requested'}>
              <span className="tool-chip__dot" />
              <code>applications.get</code>
              <span className="tool-chip__state">{step >= 5 ? 'completed' : step >= 4 ? 'allowed · executing' : 'requested'}</span>
            </div>
          )}
          {step >= 6 && (
            <div className="gen-card">
              <div className="gen-card__head">
                <strong>APP-1024</strong>
                <span className="gix-badge gix-badge--beta">Under review</span>
              </div>
              <p>Omar Farouk · Work visa · Submitted 12 Sep</p>
              <span className="gix-button gix-button--secondary gix-button--sm" aria-hidden="true">
                Open application
              </span>
            </div>
          )}
          {step >= 7 && <div className="bubble bubble--ai">APP-1024 is under review. The last document was received on 12 September.</div>}
        </div>
      </div>
      <div className="hero-demo__flow">
        <ol aria-label="Runtime events">
          {HERO_EVENTS.map((event, index) => (
            <li key={event.label} className={index < step ? (index === step - 1 && playing ? 'is-active' : 'is-done') : undefined}>
              <span className="hero-demo__icon">
                <Icon name={event.icon} size={14} />
              </span>
              <span>
                <span className="hero-demo__step">{event.label}</span>
                <code>{event.event}</code>
              </span>
            </li>
          ))}
        </ol>
        <div className="hero-demo__foot">
          <DemoLabel />
          <button type="button" className="gix-button gix-button--ghost" onClick={replay}>
            <Icon name="play" size={14} /> Replay
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- Architecture */

const ARCH: Readonly<Record<string, { readonly icon: IconName; readonly detail: string; readonly state?: 'implemented' | 'optional' | 'external' }>> = {
  User: { icon: 'user', detail: 'Your signed-in user. Identity and tenant come from your authentication adapter, never from the model.', state: 'external' },
  Copilot: { icon: 'chat', detail: 'React, Vue or Angular UI over one framework-independent chat store: streaming, stop, retry, approvals.' },
  'Application Context': { icon: 'eye', detail: 'Only what pages register (page, user, selection, state) within a token budget, with sensitivity policies.' },
  'AI Runtime': { icon: 'sparkles', detail: 'The server run loop: model runtime with retries and cancellation, tool loop, routing and fallback.' },
  Tools: { icon: 'tool', detail: 'Typed, schema-validated capabilities: frontend, backend, OpenAPI-generated and MCP tools.' },
  RAG: { icon: 'database', detail: 'Retrieval filtered by tenant and ACL before any text reaches the model, with citations.' },
  Agents: { icon: 'bot', detail: 'Specialist agents with delegation and handoff that never exceed the caller’s privileges.' },
  'Action Firewall': { icon: 'shieldCheck', detail: 'Authentication, permissions, schema, business policy, PII, rate limit, approval and audit on every consequential call.' },
  'Your Systems': { icon: 'building', detail: 'Your APIs, databases and services. Only reached through tools the firewall allowed.', state: 'external' },
};

export function ArchitectureExplorer() {
  const [active, setActive] = useState('Action Firewall');
  const node = (name: string) => <GixArchitectureNode label={name} icon={ARCH[name]?.icon} state={ARCH[name]?.state} active={active === name} onActivate={() => setActive(name)} />;
  return (
    <div className="arch">
      <div className="arch__diagram" role="group" aria-label="Runtime architecture. Select a component to read about it.">
        <div className="arch__row">{node('User')}</div>
        <div className="arch__edge" aria-hidden="true" />
        <div className="arch__row">{node('Copilot')}</div>
        <div className="arch__edge arch__edge--label" aria-hidden="true">
          <span>context</span>
        </div>
        <div className="arch__row">{node('Application Context')}</div>
        <div className="arch__edge" aria-hidden="true" />
        <div className="arch__row">{node('AI Runtime')}</div>
        <div className="arch__fan" aria-hidden="true" />
        <div className="arch__row arch__row--three">
          {node('Tools')}
          {node('RAG')}
          {node('Agents')}
        </div>
        <div className="arch__fan arch__fan--in" aria-hidden="true" />
        <div className="arch__row">{node('Action Firewall')}</div>
        <div className="arch__edge" aria-hidden="true" />
        <div className="arch__row">{node('Your Systems')}</div>
      </div>
      <div className="arch__detail" aria-live="polite">
        <span className="gix-eyebrow">{ARCH[active]?.state === 'external' ? 'Your side' : 'GIX AI'}</span>
        <h3>{active}</h3>
        <p>{ARCH[active]?.detail}</p>
        <p className="arch__legend">
          <span className="arch__swatch arch__swatch--implemented" /> SDK
          <span className="arch__swatch arch__swatch--external" /> Your application
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- Firewall */

const FIREWALL: readonly { readonly check: string; readonly detail: string }[] = [
  { check: 'Authentication', detail: 'Who is asking: from your AuthenticationAdapter' },
  { check: 'Permissions (RBAC)', detail: 'requiredPermissions on the tool' },
  { check: 'Attribute policy (ABAC)', detail: 'definePolicy rules on user, tenant, input' },
  { check: 'Schema validation', detail: 'zod input schema; invalid input never executes' },
  { check: 'Business policy', detail: 'Your rules, e.g. refund limits' },
  { check: 'PII policy', detail: 'Redaction before logs, traces and model context' },
  { check: 'Rate limit', detail: 'Per user, tenant and tool' },
  { check: 'Approval', detail: 'Risk-based human decision when required' },
  { check: 'Audit', detail: 'Append-only record of the decision' },
];

export function FirewallPipeline({ denyAt }: { readonly denyAt?: number }) {
  const { step, replay, ref } = useSequence(FIREWALL.length + 1, 420);
  const decided = step > FIREWALL.length;
  const denied = denyAt !== undefined && step > denyAt;
  return (
    <div className="firewall" ref={ref}>
      <div className="firewall__request">
        <Icon name="sparkles" size={16} /> Model requests <code>payments.refund({'{'} amount: 2450 {'}'})</code>
      </div>
      <ol className="firewall__checks" aria-label="Action Firewall checks">
        {FIREWALL.map((item, index) => {
          const state = denyAt !== undefined && index === denyAt && step > index ? 'deny' : step > index ? 'pass' : 'pending';
          return (
            <li key={item.check} data-state={denied && index > (denyAt ?? 0) ? 'skipped' : state}>
              <span className="firewall__mark" aria-hidden="true">
                {state === 'deny' ? '✕' : state === 'pass' ? '✓' : ''}
              </span>
              <span className="firewall__check">{item.check}</span>
              <span className="firewall__detail">{item.detail}</span>
            </li>
          );
        })}
      </ol>
      <div className={`firewall__decision${decided || denied ? ' is-decided' : ''}${denied ? ' is-deny' : ''}`} role="status">
        {denied ? 'DENY · nothing executed, audited' : decided ? 'ALLOW · execute and audit' : 'Checking…'}
      </div>
      <button type="button" className="gix-button gix-button--ghost" onClick={replay}>
        <Icon name="play" size={14} /> Replay
      </button>
    </div>
  );
}

/* --------------------------------------------------------------------------- Approval */

export function ApprovalCard() {
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  return (
    <div className="approval-card" role="group" aria-label="Approval request (demo)">
      <div className="approval-card__head">
        <span className="gix-eyebrow">approval.requested</span>
        <span className="gix-badge gix-badge--accent">High risk</span>
      </div>
      <p className="approval-card__action">
        AI wants to <strong>refund $2,450</strong> on payment <code>PAY-88121</code>
      </p>
      <dl>
        <div>
          <dt>Reason</dt>
          <dd>Customer refund request</dd>
        </div>
        <div>
          <dt>Requires</dt>
          <dd>Supervisor approval</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>in 30 minutes</dd>
        </div>
      </dl>
      {decision ? (
        <p className={`approval-card__result approval-card__result--${decision}`} role="status">
          {decision === 'approved' ? 'approval.approved → the tool runs once, audited' : 'approval.rejected → nothing executes, audited'}
          <button type="button" className="gix-button gix-button--ghost" onClick={() => setDecision(null)}>
            Reset
          </button>
        </p>
      ) : (
        <div className="approval-card__actions">
          <button type="button" className="gix-button gix-button--secondary" onClick={() => setDecision('rejected')}>
            Reject
          </button>
          <button type="button" className="gix-button gix-button--primary" onClick={() => setDecision('approved')}>
            Approve
          </button>
        </div>
      )}
      <p className="demo-label">Demo. In the SDK, a decision is recorded by an authorized human, bound to tenant and requester; model text can never approve.</p>
    </div>
  );
}

/* --------------------------------------------------------------------------- Workflow */

const WORKFLOW = ['Validate', 'Agent: assess', 'Payment check', 'Approval', 'Update', 'Complete'] as const;

export function WorkflowStepper() {
  const { step, replay, ref } = useSequence(WORKFLOW.length, 800);
  return (
    <div className="workflow" ref={ref}>
      <ol className="workflow__steps" aria-label="Workflow steps">
        {WORKFLOW.map((name, index) => {
          const state = index < step - 1 ? 'done' : index === step - 1 ? (index === WORKFLOW.length - 1 ? 'done' : 'active') : 'pending';
          return (
            <li key={name} data-state={state}>
              <span className="workflow__dot" aria-hidden="true" />
              <span className="workflow__name">{name}</span>
              <span className="workflow__event">{state === 'done' ? 'checkpoint saved' : state === 'active' ? (name === 'Approval' ? 'paused · awaiting decision' : 'running') : ''}</span>
            </li>
          );
        })}
      </ol>
      <div className="workflow__foot">
        <code>workflow.checkpoint.saved</code> after every step · resumable on any instance
        <button type="button" className="gix-button gix-button--ghost" onClick={replay}>
          <Icon name="play" size={14} /> Replay
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- DevTools + trace */

const DEVTOOLS_TABS = ['Overview', 'Conversation', 'Tools', 'Knowledge', 'Agents', 'Events', 'Evals'] as const;
const EVENTS = [
  ['00.000', 'run.started', ''],
  ['00.012', 'context resolved', '3 items · 412 tokens'],
  ['00.834', 'tool.requested', 'applications.get'],
  ['00.839', 'firewall decision', 'allow · read-only'],
  ['00.984', 'tool.completed', '145 ms'],
  ['01.402', 'message.delta', ''],
  ['01.921', 'run.completed', '1,842 in / 426 out'],
] as const;

export function DevToolsPreview() {
  return (
    <div className="devtools" role="group" aria-label="DevTools preview (demo data)">
      <Tabs
        label="DevTools panels"
        initial={5}
        tabs={DEVTOOLS_TABS.map((tab) => ({
          id: tab.toLowerCase(),
          label: tab,
          content:
            tab === 'Events' ? (
              <table className="devtools__events">
                <caption className="visually-hidden">Event timeline (demo data)</caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Event</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {EVENTS.map(([time, event, detail]) => (
                    <tr key={time}>
                      <td>{time}s</td>
                      <td>{event.includes('.') ? <code>{event}</code> : event}</td>
                      <td>{detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="devtools__placeholder">
                The {tab} inspector projects the same recorded session: {tab === 'Tools' ? 'every call with its firewall decision trail' : tab === 'Knowledge' ? 'RAG candidates, ACL exclusions and citations' : tab === 'Agents' ? 'agent trees, delegations and handoffs' : tab === 'Evals' ? 'evaluation runs and security hard gates' : tab === 'Conversation' ? 'messages, context budget and state timeline' : 'runs, errors and token usage'}.
              </p>
            ),
        }))}
      />
      <span className="demo-label">Demo data. DevTools is read-only, development-only and token-protected when enabled.</span>
    </div>
  );
}

const SPANS = [
  { name: 'Model call', ms: 820, offset: 0 },
  { name: 'Context', ms: 12, offset: 0 },
  { name: 'Tool: applications.get', ms: 145, offset: 839 },
  { name: 'RAG retrieval', ms: 210, offset: 12 },
  { name: 'Render', ms: 8, offset: 1402 },
] as const;

export function TracePreview() {
  const total = 1921;
  return (
    <div className="trace" role="group" aria-label="Trace preview (demo data)">
      <div className="trace__head">
        <strong>Run</strong>
        <span>1.92 s</span>
      </div>
      <ul>
        {SPANS.map((span) => (
          <li key={span.name}>
            <span className="trace__name">{span.name}</span>
            <span className="trace__track">
              <span className="trace__bar" style={{ insetInlineStart: `${(span.offset / total) * 100}%`, inlineSize: `${Math.max((span.ms / total) * 100, 1)}%` }} />
            </span>
            <span className="trace__ms">{span.ms} ms</span>
          </li>
        ))}
      </ul>
      <dl className="trace__totals">
        <div>
          <dt>Input tokens</dt>
          <dd>1,842</dd>
        </div>
        <div>
          <dt>Output tokens</dt>
          <dd>426</dd>
        </div>
        <div>
          <dt>Estimated cost</dt>
          <dd>from your pricing table</dd>
        </div>
      </dl>
      <span className="demo-label">Demo data. Costs are estimates computed from pricing you configure; no prices ship with the SDK.</span>
    </div>
  );
}
