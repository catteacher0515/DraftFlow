import { describe, expect, it } from 'vitest';

import { cleanupZhihuHtml } from '../src/core/zhihu/zhihu-adapter';

describe('zhihu adapter html cleanup', () => {
  it('removes default image caption text and compresses empty spacing around figures', () => {
    const html = [
      '<p>下面是标准 Markdown 本地图片：</p>',
      '<p><br></p>',
      '<figure><img src="https://pic-private.zhihu.com/demo.png"><figcaption class="Image-caption is-placeholder Image-captionV2">添加图片注释，不超过 140 字（可选）</figcaption></figure>',
      '<p><br></p>',
      '<p>下面是标准 Markdown 远程图片：</p>'
    ].join('');

    const cleaned = cleanupZhihuHtml(html);

    expect(cleaned).not.toContain('添加图片注释，不超过 140 字（可选）');
    expect(cleaned).not.toContain('<figcaption');
    expect(cleaned).not.toContain('<p><br></p><figure');
    expect(cleaned).not.toContain('</figure><p><br></p>');
  });
});
