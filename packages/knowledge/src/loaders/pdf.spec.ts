import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { pdfSource } from '../source.js';
import { pdfLoader } from './pdf.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

/**
 * Builds a real, valid multi-page PDF via pdf-lib for the test - `pdf-parse` (the originally
 * scaffolded dependency) turned out to fail on any input under this repo's Node runtime, which
 * is exactly why the loader was rebuilt on `pdfjs-dist` directly (see pdf.ts's header comment
 * and Phase 9 Issues); using a second, independent, actively-maintained library to construct
 * the fixture keeps this test from just validating pdfjs-dist against its own output.
 */
async function buildPdf(pageTexts: readonly string[], title?: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 72, y: 700, size: 24, font });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

describe('pdfLoader', () => {
  it('produces one KnowledgeDocument per page with page provenance (Section 18)', async () => {
    const pdf = await buildPdf(['Page One Text', 'Page Two Text']);
    const source = pdfSource({ name: 'Handbook', buffer: pdf, tenantId: 'tenant-a' });
    const docs = await collect(pdfLoader.load(source));

    expect(docs).toHaveLength(2);
    expect(docs[0]?.metadata.page).toBe(1);
    expect(docs[0]?.content).toContain('Page One Text');
    expect(docs[1]?.metadata.page).toBe(2);
    expect(docs[1]?.content).toContain('Page Two Text');
    expect(docs.every((d) => d.metadata.mimeType === 'application/pdf')).toBe(true);
    expect(docs.every((d) => d.metadata.title === 'Handbook')).toBe(true);
    expect(docs.every((d) => d.metadata.tenantId === 'tenant-a')).toBe(true);
  });

  it('prefers the PDF document Title over the source name', async () => {
    const pdf = await buildPdf(['Only Page'], 'Embedded Title');
    const source = pdfSource({ name: 'Fallback Name', buffer: pdf });
    const [doc] = await collect(pdfLoader.load(source));
    expect(doc?.metadata.title).toBe('Embedded Title');
  });

  it('assigns stable ids per page across re-ingestion (Section 13)', async () => {
    const pdf = await buildPdf(['Only Page']);
    const source = pdfSource({ id: 'handbook', buffer: pdf });
    const first = await collect(pdfLoader.load(source));
    const second = await collect(pdfLoader.load(source));
    expect(first[0]?.id).toBe(second[0]?.id);
  });

  it('rejects a source with neither path nor buffer', async () => {
    const source = pdfSource({});
    await expect(collect(pdfLoader.load(source))).rejects.toThrow(CopilotError);
  });
});
