import { createInterface } from 'node:readline/promises';

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** The questions the installer asks. Non-interactive runs answer every one with its default. */
export interface Prompter {
  select<T extends string>(question: string, choices: readonly Choice<T>[], initial: T): Promise<T>;
  confirm(question: string, initial: boolean): Promise<boolean>;
  text(question: string, initial: string): Promise<string>;
  close(): void;
}

export const defaultsPrompter: Prompter = {
  select: (_question, _choices, initial) => Promise.resolve(initial),
  confirm: (_question, initial) => Promise.resolve(initial),
  text: (_question, initial) => Promise.resolve(initial),
  close: () => undefined,
};

/** Plain readline prompts: numbered choices, Enter accepts the default. */
export function terminalPrompter(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Prompter {
  const rl = createInterface({ input, output });
  return {
    async select(question, choices, initial) {
      output.write(`\n? ${question}\n`);
      choices.forEach((choice, index) => output.write(`  ${index + 1}) ${choice.label}${choice.value === initial ? '  (default)' : ''}\n`));
      for (;;) {
        const answer = (await rl.question('  Choose a number: ')).trim();
        if (!answer) return initial;
        const picked = choices[Number(answer) - 1] ?? choices.find((choice) => choice.value === answer);
        if (picked) return picked.value;
        output.write(`  Please enter 1-${choices.length}.\n`);
      }
    },
    async confirm(question, initial) {
      for (;;) {
        const answer = (await rl.question(`? ${question} ${initial ? '(Y/n)' : '(y/N)'} `)).trim().toLowerCase();
        if (!answer) return initial;
        if (['y', 'yes'].includes(answer)) return true;
        if (['n', 'no'].includes(answer)) return false;
      }
    },
    async text(question, initial) {
      const answer = (await rl.question(`? ${question} (${initial}) `)).trim();
      return answer || initial;
    },
    close: () => rl.close(),
  };
}
