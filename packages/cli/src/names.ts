/** `applications-get` -> `applications.get`; `payments-refund-full` -> `payments.refundFull`. */
export function toolNameFromSlug(slug: string): string {
  const parts = slug.trim().toLowerCase().split(/[-_.\s]+/).filter(Boolean);
  if (parts.length < 2) throw new Error('Tool names need a namespace and an action, e.g. "applications-get".');
  const [namespace, ...rest] = parts as [string, ...string[]];
  const action = rest.map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('');
  const name = `${namespace}.${action}`;
  if (!/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error(`Invalid tool name "${name}".`);
  return name;
}

/** `support-agent` -> `supportAgent` (identifier), kept as the agent id `support-agent`. */
export function identifierFromSlug(slug: string): string {
  const parts = slug.trim().split(/[-_.\s]+/).filter(Boolean);
  const identifier = parts.map((part, index) => (index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())).join('');
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(identifier)) throw new Error(`Invalid name "${slug}".`);
  return identifier;
}

export function fileSlug(slug: string): string {
  const value = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!value) throw new Error(`Invalid name "${slug}".`);
  return value;
}

export function packageName(value: string): string {
  const name = value.trim().toLowerCase().replace(/[^a-z0-9-~._]+/g, '-').replace(/^[-.]+|-+$/g, '');
  if (!name) throw new Error('Invalid project name.');
  return name;
}
