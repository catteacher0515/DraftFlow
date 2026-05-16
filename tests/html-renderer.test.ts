import { describe, expect, it } from 'vitest';

import { renderMarkdownToHtml } from '../src/core/markdown/html-renderer';

describe('html renderer', () => {
  it('renders common markdown structures into html', async () => {
    const html = await renderMarkdownToHtml([
      '# 标题',
      '',
      '这是 **加粗** 和 *斜体*。',
      '',
      '> 引用内容',
      '',
      '- 列表一',
      '- 列表二',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |'
    ].join('\n'));

    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre><code class="language-ts">const a = 1;');
    expect(html).toContain('<table>');
  });
});
