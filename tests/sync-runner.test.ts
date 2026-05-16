import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSync } from '../src/core/sync-runner';
import { createTaskStore } from '../src/core/task-store';

const fixturePath = path.resolve('tests/fixtures/sample-article.md');
const listNoteFixturePath = path.resolve('tests/fixtures/list-note.md');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('sync runner', () => {
  async function createTempMarkdownWithImage(markdown: string, imageName = 'local-image.png') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-sync-fixture-'));
    tempDirs.push(root);
    const filePath = path.join(root, 'article.md');
    const imagePath = path.join(root, imageName);
    await fs.writeFile(filePath, markdown, 'utf8');
    await fs.writeFile(imagePath, 'png', 'utf8');
    return { filePath, imagePath };
  }

  it('fails when no final title can be resolved', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-sync-runner-'));
    tempDirs.push(root);
    const noTitlePath = path.join(root, 'no-title.md');
    await fs.writeFile(noTitlePath, '正文没有一级标题', 'utf8');

    const result = await runSync(
      {
        sourcePath: noTitlePath,
        manualTitle: '   ',
        platform: 'juejin'
      },
      {
        createDraft: vi.fn()
      }
    );

    expect(result.status).toBe('failure');
    expect(result.errorMessage).toBe('title is required');
  });

  it('continues when local image upload fails', async () => {
    const result = await runSync(
      {
        sourcePath: fixturePath,
        manualTitle: '手动标题',
        platform: 'juejin'
      },
      {
        createDraft: vi.fn().mockResolvedValue({
          draftId: '123',
          draftUrl: 'https://juejin.cn/editor/drafts/123'
        }),
        uploadLocalImage: vi.fn().mockRejectedValue(new Error('upload failed'))
      }
    );

    expect(result.status).toBe('partial_success');
    expect(result.failedImages).toContain('./local-image.png');
    expect(result.draftId).toBe('123');
  });

  it('uses the first list item as fallback title when no h1 exists', async () => {
    const { filePath } = await createTempMarkdownWithImage(
      '1. 口播邪修\n\n2. 正文\n\n![[Pasted image 20260515150949.png]]\n',
      'Pasted image 20260515150949.png'
    );
    const uploadLocalImage = vi.fn().mockResolvedValue('https://cdn.example.com/pasted-image.png');
    const createDraft = vi.fn().mockResolvedValue({
      draftId: '456',
      draftUrl: 'https://juejin.cn/editor/drafts/456'
    });

    const result = await runSync(
      {
        sourcePath: filePath,
        manualTitle: '',
        platform: 'juejin'
      },
      {
        uploadLocalImage,
        createDraft
      }
    );

    expect(result.status).toBe('success');
    expect(result.title).toBe('口播邪修');
    expect(result.draftId).toBe('456');
    expect(uploadLocalImage).toHaveBeenCalledOnce();
    expect(createDraft).toHaveBeenCalledOnce();
    expect(createDraft.mock.calls[0]?.[0]?.mark_content).toContain('https://cdn.example.com/pasted-image.png');
  });

  it('persists raw markdown snapshots under the task store root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-sync-runner-'));
    tempDirs.push(root);

    const createDraft = vi.fn().mockResolvedValue({
      draftId: '789',
      draftUrl: 'https://juejin.cn/editor/drafts/789'
    });

    const result = await runSync(
      {
        sourcePath: fixturePath,
        manualTitle: '',
        platform: 'juejin'
      },
      {
        rootDir: root,
        createDraft
      }
    );

    const taskStore = createTaskStore(root);
    const history = await taskStore.list();
    const entry = history.find((item) => item.taskId && item.draftId === result.draftId);

    expect(entry).toBeDefined();
    expect(entry?.snapshotPath?.startsWith(path.join(root, 'tasks', 'snapshots'))).toBe(true);

    const snapshot = await taskStore.getSnapshot(entry!.taskId);
    const originalMarkdown = await fs.readFile(fixturePath, 'utf8');

    expect(snapshot?.content).toBe(originalMarkdown);
  });

  it('can sync from snapshot markdown instead of re-reading the source file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-sync-runner-'));
    tempDirs.push(root);
    const missingPath = path.join(root, 'missing.md');
    const createDraft = vi.fn().mockResolvedValue({
      draftId: '999',
      draftUrl: 'https://juejin.cn/editor/drafts/999'
    });

    const result = await runSync(
      {
        sourcePath: missingPath,
        manualTitle: '',
        platform: 'juejin'
      },
      {
        rootDir: root,
        sourceMarkdown: '# Snapshot Title\n\nsnapshot body\n',
        createDraft
      }
    );

    expect(result.status).toBe('success');
    expect(result.title).toBe('Snapshot Title');
    expect(createDraft).toHaveBeenCalledOnce();
    expect(createDraft.mock.calls[0]?.[0]?.mark_content).toContain('snapshot body');
  });

  it('degrades local images with a clear warning when the platform has no uploader yet', async () => {
    const createDraft = vi.fn().mockResolvedValue({
      draftId: '321',
      draftUrl: 'https://example.com/draft/321'
    });

    const result = await runSync(
      {
        sourcePath: fixturePath,
        manualTitle: '',
        platform: 'zhihu'
      },
      {
        createDraft
      }
    );

    expect(result.status).toBe('partial_success');
    expect(result.failedImages).toEqual(['./local-image.png']);
    expect(result.warnings.some((item) => item.code === 'LOCAL_IMAGE_UPLOAD_FAILED')).toBe(true);
    expect(createDraft.mock.calls[0]?.[0]?.mark_content).toContain('[图片待补充：./local-image.png]');
  });

  it('passes local image paths into createDraft when the platform manages images in the editor', async () => {
    const { filePath, imagePath } = await createTempMarkdownWithImage(
      '# DraftFlow MVP\n\n正文\n\n![本地图片](./local-image.png)\n'
    );
    const createDraft = vi.fn().mockResolvedValue({
      draftId: '654',
      draftUrl: 'https://example.com/draft/654',
      uploadedImages: ['./local-image.png'],
      failedImages: [],
      warnings: []
    });

    const result = await runSync(
      {
        sourcePath: filePath,
        manualTitle: '',
        platform: 'zhihu'
      },
      {
        manageImagesInDraft: true,
        createDraft
      }
    );

    expect(result.status).toBe('success');
    expect(result.uploadedImageCount).toBe(1);
    expect(result.failedImages).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(createDraft).toHaveBeenCalledOnce();
    expect(createDraft.mock.calls[0]?.[0]?.localImageMap).toEqual({
      './local-image.png': imagePath
    });
  });
});
