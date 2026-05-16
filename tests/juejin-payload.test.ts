import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildJuejinDraftPayload, replaceLocalImageUrls } from '../src/core/juejin/juejin-payload';
import { parseMarkdownDocument } from '../src/core/markdown/markdown-parser';

const fixturePath = path.resolve('tests/fixtures/sample-article.md');

describe('juejin payload', () => {
  it('replaces uploaded local image urls and preserves remote image urls', async () => {
    const doc = await parseMarkdownDocument(fixturePath);
    const markdown = replaceLocalImageUrls(doc.rawMarkdown, {
      './local-image.png': 'https://cdn.example.com/local.png'
    });

    expect(markdown).toContain('https://cdn.example.com/local.png');
    expect(markdown).toContain('https://example.com/hero.png');
  });

  it('rewrites obsidian wiki image syntax into standard markdown images', () => {
    const markdown = replaceLocalImageUrls('6. ![[Pasted image 20260515150949.png]]', {
      'Pasted image 20260515150949.png': 'https://cdn.example.com/pasted-image.png'
    });

    expect(markdown).toContain('![](https://cdn.example.com/pasted-image.png)');
    expect(markdown).not.toContain('![[https://cdn.example.com/pasted-image.png]]');
  });

  it('builds a create-draft payload with markdown edit type', async () => {
    const doc = await parseMarkdownDocument(fixturePath);
    const payload = buildJuejinDraftPayload({
      title: 'DraftFlow',
      markdown: doc.rawMarkdown,
      categoryId: '0'
    });

    expect(payload).toMatchObject({
      title: 'DraftFlow',
      category_id: '0',
      edit_type: 10,
      mark_content: doc.rawMarkdown
    });
  });
});
