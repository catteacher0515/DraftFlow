import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMarkdownDocument } from '../src/core/markdown/markdown-parser';
import { preprocessMarkdown } from '../src/core/markdown/preprocess';

const listNoteFixturePath = path.resolve('tests/fixtures/list-note.md');
const frontmatterFixturePath = path.resolve('tests/fixtures/frontmatter-note.md');

describe('markdown preprocess', () => {
  it('normalizes obsidian image syntax before replacement', async () => {
    const doc = await parseMarkdownDocument(listNoteFixturePath);
    const result = preprocessMarkdown({
      doc,
      uploadedImageMap: {
        'Pasted image 20260515150949.png': 'https://cdn.example.com/pasted.png'
      },
      failedImages: []
    });

    expect(result.markdown).toContain('![](https://cdn.example.com/pasted.png)');
    expect(result.markdown).not.toContain('![[Pasted image 20260515150949.png]]');
  });

  it('appends a degradation note when some images fail', async () => {
    const doc = await parseMarkdownDocument(listNoteFixturePath);
    const result = preprocessMarkdown({
      doc,
      uploadedImageMap: {},
      failedImages: ['Pasted image 20260515150949.png']
    });

    expect(result.warnings[0]?.code).toBe('IMAGE_DEGRADED_TO_TEXT');
    expect(result.markdown).toContain('图片同步降级说明：');
    expect(result.markdown).toContain('- Pasted image 20260515150949.png');
    expect(result.markdown).toContain('[图片待补充：Pasted image 20260515150949.png]');
    expect(result.markdown).not.toContain('![[Pasted image 20260515150949.png]]');
  });

  it('removes frontmatter during preprocessing', async () => {
    const doc = await parseMarkdownDocument(frontmatterFixturePath);
    const result = preprocessMarkdown({
      doc,
      uploadedImageMap: {},
      failedImages: []
    });

    expect(result.markdown).not.toContain('---\ntitle:');
    expect(result.markdown).toContain('# Frontmatter Note');
    expect(result.markdown).toContain('这是正文。');
  });
});
