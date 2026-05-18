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
    expect(html).toContain('<blockquote class="blockquote">');
    expect(html).toContain('<p>• 列表一<br>• 列表二</p>');
    expect(html).toContain('<pre lang="typescript"><code class="language-typescript">const a = 1;</code></pre>');
    expect(html).toContain('<table data-draft-node="block" data-draft-type="table" data-size="normal">');
    expect(html).toContain('<tbody><tr>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<th>B</th>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<td>2</td>');
  });

  it('normalizes compact lists and preserves native dividers for zhihu html', async () => {
    const html = await renderMarkdownToHtml([
      '1. 第一步',
      '2. 第二步',
      '',
      '- [x] 已完成事项',
      '- [ ] 未完成事项',
      '',
      '---'
    ].join('\n'));

    expect(html).toContain('<p>1. 第一步<br>2. 第二步</p>');
    expect(html).toContain('<p>[x] 已完成事项<br>[ ] 未完成事项</p>');
    expect(html).toContain('<hr>');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<ol');
  });
});
