import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CopilotProvider, useCopilotChat, useInvokeTool } from '@gixcopilot/react';
import { ApprovalCard, CopilotChat } from '@gixcopilot/ui';
import type { ApprovalState } from '@gixcopilot/react';
import '@gixcopilot/ui/styles.css';
import './styles.css';

const base = '/api/copilot';
const roles = ['viewer', 'officer', 'supervisor', 'supervisor2', 'admin'];

function Workspace({ model }: { readonly model: string | null }) {
  const invoke = useInvokeTool();
  const chat = useCopilotChat();
  const [result, setResult] = useState('Choose an action or ask the copilot.');
  const busy = ['submitting', 'streaming', 'waiting_for_approval'].includes(chat.status);
  return <>
    <section className="action-panel" aria-label="Application actions">
      <span className="eyebrow">APPLICATION / APP-1024</span>
      <h2>Review before changing.</h2>
      <p>Read a record, preview a change, then authorize it with the appropriate identity.</p>
      <div className="action-grid">{[
        ['Read application', 'get'], ['Confirm assignment', 'confirm'], ['Supervisor reassignment', 'reassign'],
        ['Two-person transfer', 'transfer'], ['Delete permanently', 'delete'],
      ].map(([label, action]) => <button key={action} disabled={busy} onClick={() => {
        void invoke(`applications.${action}`, { applicationId: 'APP-1024', officerId: 'Officer B' }).then((value) => setResult(JSON.stringify(value, null, 2)));
      }}>{label}</button>)}</div>
      <pre aria-label="Safe action result">{result}</pre>
      {!model ? <p role="status">Chat needs OPENAI_API_KEY and OPENAI_MODEL on the server. Action controls work now.</p> : null}
    </section>
    <CopilotChat title="Enterprise copilot" suggestions={model ? ['Show APP-1024', 'Reassign APP-1024 to Officer B', 'Delete APP-1024'] : []} />
  </>;
}

function ReviewDesk() {
  const [reviewer, setReviewer] = useState('supervisor');
  const [approvals, setApprovals] = useState<ApprovalState[]>([]);
  const [history, setHistory] = useState<readonly { id: string; decision: string; action: string }[]>([]);
  const [error, setError] = useState('');
  async function refresh(): Promise<void> {
    try {
      const headers = { authorization: `Bearer ${reviewer}` };
      const [pending, actions] = await Promise.all([fetch(`${base}/approvals`, { headers }), fetch(`${base}/actions`, { headers })]);
      if (!pending.ok || !actions.ok) throw new Error('Refresh failed');
      const body = await pending.json() as { approvals: (Omit<ApprovalState, 'status'> & { status: ApprovalState['status'] | 'partially_approved'; requiredApprovers: number; approvals: unknown[] })[] };
      setApprovals(body.approvals.map((approval) => ({ ...approval, action: approval.action ?? 'Application action',
        status: approval.status === 'partially_approved' ? 'pending' : approval.status,
        summary: `${approval.summary} (${approval.approvals.length}/${approval.requiredApprovers} approvals)` })));
      setHistory((await actions.json() as { actions: typeof history }).actions);
      setError('');
    } catch { setError('Could not refresh the review desk.'); }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 1500);
    return () => clearInterval(timer);
  }, [reviewer]);
  async function decide(id: string, decision: string): Promise<void> {
    const response = await fetch(`${base}/approvals/${id}/${decision}`, { method: 'POST', headers: { authorization: `Bearer ${reviewer}` } });
    if (!response.ok) throw new Error('Decision denied');
    await refresh();
  }
  return <aside className="review-desk">
    <span className="eyebrow">HUMAN REVIEW</span><h2>Approval desk</h2>
    <label>Reviewer identity <select value={reviewer} onChange={(event) => setReviewer(event.target.value)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
    <p>Supervisor and admin approvals require a different person. Two-person transfer needs two distinct reviewers.</p>
    {error ? <p role="alert">{error}</p> : null}
    {approvals.map((approval) => <ApprovalCard key={approval.approvalId} approval={approval} onApprove={(id) => decide(id, 'approve')} onReject={(id) => decide(id, 'reject')} />)}
    <h3>Action history</h3><ol>{history.slice(-12).reverse().map((record) => <li key={record.id}>{record.action} · {record.decision}</li>)}</ol>
  </aside>;
}

function App() {
  const [requester, setRequester] = useState('officer');
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => { void fetch(`${base}/demo-config`).then((response) => response.json()).then((data: { model: string | null }) => setModel(data.model)); }, []);
  return <main><header className="page-header"><div><span className="eyebrow">GIX COPILOT / ENTERPRISE</span><h1>Authority stays with people.</h1><p>Security fixtures for a real application. Demo credentials are not production authentication.</p></div>
    <label>Requester <select value={requester} onChange={(event) => setRequester(event.target.value)}>{['viewer', 'officer'].map((role) => <option key={role}>{role}</option>)}</select></label></header>
    <div className="workspace"><CopilotProvider key={requester} runtimeUrl={base} model={model ? { provider: 'openai', model } : undefined} getHeaders={() => ({ authorization: `Bearer ${requester}` })}><Workspace model={model} /></CopilotProvider><ReviewDesk /></div>
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
