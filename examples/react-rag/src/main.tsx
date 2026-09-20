import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CitationList, Markdown } from '@gixcopilot/ui';
import type { CitationData } from '@gixcopilot/react';
import './styles.css';

interface Answer { text: string; citations: readonly CitationData[]; grounded: boolean }
interface SavedMemory { record: { id: string; value: unknown; expiresAt?: string } }

function App(): ReactElement {
  const [role, setRole] = useState('viewer');
  const [question, setQuestion] = useState('How many days of annual leave do employees receive, and how many can be carried over?');
  const [answer, setAnswer] = useState<Answer>();
  const [memory, setMemory] = useState('I prefer concise technical answers.');
  const [saved, setSaved] = useState<readonly SavedMemory[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/api${path}`, { method, headers: { Authorization: `Bearer ${role}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(typeof result === 'object' && result !== null && 'error' in result ? String(result.error) : 'Request failed.');
    return result as T;
  }
  useEffect(() => { setAnswer(undefined); setSaved([]); setError(''); }, [role]);
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Request failed.'); }
    finally { setBusy(false); }
  }
  return <main>
    <header><p className="eyebrow">AI COPILOT SDK · PHASE 09</p><h1>Ask your knowledge.</h1>
      <p>Explore company policies with cited sources and explicitly saved preferences.</p></header>
    <label>Demo identity <select value={role} disabled={busy} onChange={(event) => setRole(event.target.value)}>
      <option value="viewer">Viewer · public handbook</option><option value="supervisor">Supervisor · operations guide</option>
      <option value="admin">Admin · security procedure</option></select></label>
    <div className="layout"><section className="panel">
      <h2>Knowledge</h2><form onSubmit={(event) => { event.preventDefault(); void run(async () => setAnswer(await request<Answer>('/ask', 'POST', { text: question }))); }}>
        <label htmlFor="question">Your question</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} required maxLength={4000} />
        <button disabled={busy} type="submit">{busy ? 'Working…' : 'Ask with sources'}</button>
      </form>
      <p className="hint">Try “What is the key rotation schedule?” as Viewer, then Admin.</p>
      {answer && <article aria-label="Answer"><p className="eyebrow">{answer.grounded ? 'Includes validated source references' : 'No validated source references'}</p>
        <Markdown content={answer.text} /><CitationList citations={answer.citations} /></article>}
    </section><section className="panel"><h2>Saved memory</h2><p>Save only what you want remembered. Current instructions take precedence.</p>
      <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
        await request('/memory', 'POST', { value: memory }); setSaved(await request<readonly SavedMemory[]>('/memory'));
      }); }}><label htmlFor="memory">Preference to remember</label><textarea id="memory" value={memory} onChange={(event) => setMemory(event.target.value)} required maxLength={2000} />
        <button type="submit" disabled={busy}>Save to memory</button></form>
      <button className="secondary" disabled={busy} onClick={() => void run(async () => setSaved(await request<readonly SavedMemory[]>('/memory')))}>View saved memory</button>
      <ul>{saved.map(({ record }) => <li key={record.id}><p>{String(record.value)}</p><button className="secondary" disabled={busy} onClick={() => void run(async () => {
        await request(`/memory/${encodeURIComponent(record.id)}`, 'DELETE'); setSaved(await request<readonly SavedMemory[]>('/memory'));
      })}>Forget this memory</button></li>)}</ul>
    </section></div>
    {error && <p role="alert" className="error">{error}</p>}
    <footer>Local development identities. Real OpenAI chat and embeddings require server configuration.</footer>
  </main>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
