import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTaskStore } from '../src/core/task-store';
import type { TaskHistoryEntry, TaskSnapshot } from '../src/core/types';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function makeEntry(taskId: string): TaskHistoryEntry {
  return {
    taskId,
    startedAt: new Date('2026-05-15T00:00:00.000Z').toISOString(),
    finishedAt: new Date('2026-05-15T00:00:05.000Z').toISOString(),
    status: 'success',
    platform: 'juejin',
    sourceFile: '/tmp/article.md',
    title: `title-${taskId}`,
    manualTitle: 'manual-title',
    uploadedImageCount: 1,
    failedImages: [],
    warnings: []
  };
}

function makeSnapshot(taskId: string): TaskSnapshot {
  return {
    taskId,
    platform: 'juejin',
    sourceFile: '/tmp/article.md',
    manualTitle: 'manual-title',
    snapshotPath: `/tmp/${taskId}.md`,
    createdAt: new Date('2026-05-15T00:00:00.000Z').toISOString()
  };
}

describe('task store', () => {
  it('bootstraps an empty history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-task-store-'));
    tempDirs.push(root);
    const store = createTaskStore(root);

    await expect(store.list()).resolves.toEqual([]);
  });

  it('appends entries and lists newest first', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-task-store-'));
    tempDirs.push(root);
    const store = createTaskStore(root);

    await store.append(makeEntry('1'));
    await store.append({
      ...makeEntry('2'),
      finishedAt: new Date('2026-05-15T00:00:10.000Z').toISOString()
    });

    const history = await store.list();
    expect(history.map((entry) => entry.taskId)).toEqual(['2', '1']);
  });

  it('persists and reads task snapshots', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-task-store-'));
    tempDirs.push(root);
    const store = createTaskStore(root);

    await store.saveSnapshot(makeSnapshot('task-1'), '# snapshot body');

    await expect(store.getSnapshot('task-1')).resolves.toEqual({
      meta: makeSnapshot('task-1'),
      content: '# snapshot body'
    });
  });

  it('returns null when snapshot is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-task-store-'));
    tempDirs.push(root);
    const store = createTaskStore(root);

    await expect(store.getSnapshot('missing')).resolves.toBeNull();
  });

  it('builds snapshot paths inside the task snapshot directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-task-store-'));
    tempDirs.push(root);
    const store = createTaskStore(root);

    expect(store.buildSnapshotPath('task-1')).toBe(path.join(root, 'tasks', 'snapshots', 'task-1.md'));
  });
});
