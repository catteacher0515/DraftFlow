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
    expect(html).toContain('<pre data-language="TypeScript"><code class="language-typescript">const a = 1;');
    expect(html).toContain('<p><strong>A｜B</strong><br>1｜2</p>');
  });

  it('normalizes compact lists and divider output for zhihu html', async () => {
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
    expect(html).toContain('<p>---</p>');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<hr');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<ol');
    expect(html).not.toContain('<table');
  });
});
