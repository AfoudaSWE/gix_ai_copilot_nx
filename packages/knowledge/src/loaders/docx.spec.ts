import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { docxSource } from '../source.js';
import { docxLoader } from './docx.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function documentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Travel Policy</w:t></w:r></w:p>
    <w:p><w:r><w:t>Employees must book travel two weeks in advance.</w:t></w:r></w:p>
  </w:body>
</w:document>`;
}

async function buildMinimalDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/document.xml', documentXml());
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('docxLoader', () => {
  it('extracts heading and paragraph text from a real minimal docx', async () => {
    const buffer = await buildMinimalDocx();
    const source = docxSource({ buffer, tenantId: 'tenant-a' });
    const docs = await collect(docxLoader.load(source));

    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toContain('Travel Policy');
    expect(docs[0]?.content).toContain('Employees must book travel two weeks in advance.');
    expect(docs[0]?.metadata.title).toBe('Travel Policy');
    expect(docs[0]?.metadata.tenantId).toBe('tenant-a');
    expect(docs[0]?.metadata.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('prefers an explicit source name over the extracted heading', async () => {
    const buffer = await buildMinimalDocx();
    const source = docxSource({ name: 'Custom Title', buffer });
    const [doc] = await collect(docxLoader.load(source));
    expect(doc?.metadata.title).toBe('Custom Title');
  });

  it('rejects a source with neither path nor buffer', async () => {
    const source = docxSource({});
    await expect(collect(docxLoader.load(source))).rejects.toThrow(CopilotError);
  });
});
