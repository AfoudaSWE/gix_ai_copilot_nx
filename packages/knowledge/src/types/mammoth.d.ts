/**
 * Mammoth ships no TypeScript declarations and no `@types/mammoth` package exists on the
 * registry - this stub covers only the surface `docx.ts` actually calls, deliberately not a
 * full re-declaration of the library.
 */
declare module 'mammoth' {
  export interface ConvertToHtmlInput {
    buffer?: Buffer;
    path?: string;
  }
  export interface ConvertToHtmlResult {
    value: string;
    messages: readonly unknown[];
  }
  export function convertToHtml(input: ConvertToHtmlInput): Promise<ConvertToHtmlResult>;
}
