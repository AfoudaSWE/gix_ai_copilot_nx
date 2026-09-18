import type { ThreadId } from './ids.js';

export interface Thread {
  readonly id: ThreadId;
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
