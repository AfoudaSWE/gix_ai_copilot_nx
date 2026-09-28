import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { useCopilotContext, useCopilotStatus } from '@gixcopilot/react';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Member' | 'Viewer';
  createdAt: string;
}

interface UserInput {
  name: string;
  email: string;
  role: User['role'];
}
const emptyForm: UserInput = { name: '', email: '', role: 'Member' };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/users${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    let message = 'Request failed. Please try again.';
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const detail = body.message;
      if (typeof detail === 'string') message = detail;
      else if (Array.isArray(detail))
        message = detail.filter((item): item is string => typeof item === 'string').join(' ');
    }
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

/** Manage persisted users through the example's NestJS API. */
export function App(): ReactElement {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<UserInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback((isActive: () => boolean = () => true) => {
    void request<User[]>('')
      .then((items) => {
        if (isActive()) setUsers(items);
      })
      .catch((cause: unknown) => {
        if (isActive()) setError(cause instanceof Error ? cause.message : 'Unable to load users.');
      })
      .finally(() => {
        if (isActive()) setLoading(false);
      });
  }, []);

  useEffect(() => {
    let active = true;
    load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  // The copilot's tools change users on the server, so reload once a copilot run finishes.
  const copilotStatus = useCopilotStatus();
  useEffect(() => {
    if (copilotStatus === 'completed') load();
  }, [copilotStatus, load]);

  // Lets the copilot resolve "this person" to the user open in the edit form.
  const editingUser = editingId ? users.find((user) => user.id === editingId) : undefined;
  useCopilotContext({
    id: 'editing-user',
    name: 'editingUser',
    description: 'The user currently open in the edit form',
    scope: 'component',
    enabled: editingUser !== undefined,
    value: editingUser ?? null,
  });

  const visible = users.filter((user) =>
    `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(query.toLowerCase()),
  );

  function startEdit(user: User): void {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, role: user.role });
    setError('');
    setNotice('');
    document.getElementById('name')?.focus();
  }

  function cancelEdit(): void {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const user = await request<User>(editingId ? `/${editingId}` : '', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      setUsers((current) =>
        editingId ? current.map((item) => (item.id === user.id ? user : item)) : [...current, user],
      );
      setNotice(editingId ? 'User updated.' : 'User added.');
      setEditingId(null);
      setForm(emptyForm);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save user.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(user: User): Promise<void> {
    if (!window.confirm(`Delete ${user.name}?`)) return;
    setError('');
    setNotice('');
    try {
      await request<void>(`/${user.id}`, { method: 'DELETE' });
      setUsers((current) => current.filter((item) => item.id !== user.id));
      if (editingId === user.id) cancelEdit();
      setNotice('User deleted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete user.');
    }
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand-mark">
          P<span>.</span>
        </div>
        <div className="brand-caption">
          PEOPLE
          <br />
          DIRECTORY
        </div>
        <span className="environment">LOCAL WORKSPACE</span>
      </header>
      <main>
        <div className="intro">
          <div>
            <p className="eyebrow">USERS / DIRECTORY</p>
            <h1>
              People,
              <br />
              <em>in one place.</em>
            </h1>
            <p className="intro-copy">
              Keep your team directory clear and current. Add a person, update their details, or
              remove an old record.
            </p>
          </div>
          <div className="count">
            <strong>{users.length.toString().padStart(2, '0')}</strong>
            <span>PEOPLE ON FILE</span>
          </div>
        </div>
        <div className="workspace">
          <section className="list-panel" aria-labelledby="directory-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">01 / BROWSE</p>
                <h2 id="directory-heading">Directory</h2>
              </div>
              <span className="record-count">{visible.length} records</span>
            </div>
            <label className="search-label" htmlFor="search">
              Search people
            </label>
            <input
              id="search"
              className="search"
              type="search"
              placeholder="Search by name, email, or role"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {loading ? (
              <p className="state">Loading users…</p>
            ) : visible.length === 0 ? (
              <p className="state">
                {users.length
                  ? 'No people match this search.'
                  : 'No people yet. Use the form to add the first person.'}
              </p>
            ) : (
              <div className="records">
                {visible.map((user) => (
                  <article className="record" key={user.id}>
                    <div className="avatar" aria-hidden="true">
                      {user.name.trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="person">
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                    </div>
                    <span className={`role role-${user.role.toLowerCase()}`}>{user.role}</span>
                    <div className="row-actions">
                      <button
                        type="button"
                        onClick={() => startEdit(user)}
                        aria-label={`Edit ${user.name}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          void remove(user);
                        }}
                        aria-label={`Delete ${user.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="form-panel" aria-labelledby="form-heading">
            <p className="eyebrow">02 / {editingId ? 'EDIT' : 'CREATE'}</p>
            <h2 id="form-heading">{editingId ? 'Edit person' : 'Add a person'}</h2>
            <p className="form-copy">
              {editingId
                ? 'Update the details below and save your changes.'
                : 'A few details are all you need to get started.'}
            </p>
            <form
              onSubmit={(event) => {
                void save(event);
              }}
            >
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                required
                maxLength={100}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Alex Morgan"
              />
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                required
                type="email"
                maxLength={254}
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="alex@example.com"
              />
              <label htmlFor="role">Role</label>
              <select
                id="role"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as User['role'] })}
              >
                <option>Member</option>
                <option>Admin</option>
                <option>Viewer</option>
              </select>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add person'}{' '}
                <span aria-hidden="true">↗</span>
              </button>
              {editingId && (
                <button type="button" className="cancel" onClick={cancelEdit}>
                  Cancel editing
                </button>
              )}
            </form>
          </section>
        </div>
        <div className="feedback" role="status" aria-live="polite">
          {error && <p className="error">{error}</p>}
          {notice && <p className="success">{notice}</p>}
        </div>
      </main>
      <footer>
        PEOPLE DIRECTORY <span>·</span> REACT + NESTJS EXAMPLE
      </footer>
    </div>
  );
}
