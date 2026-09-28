import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: 'Admin' | 'Member' | 'Viewer';
  readonly createdAt: string;
}

const fields = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  role: z.enum(['Admin', 'Member', 'Viewer']),
});
export const createUserSchema = fields;
export const updateUserSchema = fields.partial().refine((value) => Object.keys(value).length > 0);
export type UserInput = z.infer<typeof createUserSchema>;

@Injectable()
export class UsersService {
  private readonly file = process.env.USERS_DATA_FILE ?? 'data/users.json';
  private pending: Promise<void> = Promise.resolve();

  private async read(): Promise<User[]> {
    try {
      const content: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      return z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            role: z.enum(['Admin', 'Member', 'Viewer']),
            createdAt: z.string(),
          }),
        )
        .parse(content);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return [];
      throw error;
    }
  }

  private async save(users: User[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(users, null, 2), 'utf8');
    await rename(temporary, this.file);
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async list(): Promise<User[]> {
    await this.pending;
    return this.read();
  }

  async get(id: string): Promise<User> {
    const user = (await this.list()).find((item) => item.id === id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(input: UserInput): Promise<User> {
    return this.exclusive(async () => {
      const users = await this.read();
      if (users.some((user) => user.email === input.email))
        throw new ConflictException('Email already exists');
      const user: User = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
      await this.save([...users, user]);
      return user;
    });
  }

  async update(id: string, input: Partial<UserInput>): Promise<User> {
    return this.exclusive(async () => {
      const users = await this.read();
      const index = users.findIndex((user) => user.id === id);
      if (index < 0) throw new NotFoundException('User not found');
      if (input.email && users.some((user) => user.id !== id && user.email === input.email)) {
        throw new ConflictException('Email already exists');
      }
      const user = { ...users[index], ...input } as User;
      users[index] = user;
      await this.save(users);
      return user;
    });
  }

  async remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      const users = await this.read();
      if (!users.some((user) => user.id === id)) throw new NotFoundException('User not found');
      await this.save(users.filter((user) => user.id !== id));
    });
  }
}

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
  return parsed.data;
}
