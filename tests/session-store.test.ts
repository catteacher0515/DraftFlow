import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSessionStore } from '../src/core/session-store';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('session store', () => {
  it('returns the expected storage-state path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-session-store-'));
    tempDirs.push(root);
    const store = createSessionStore(root);

    expect(store.getStorageStatePath()).toBe(path.join(root, 'sessions', 'juejin', 'storage-state.json'));
  });

  it('supports custom platform namespaces', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-session-store-'));
    tempDirs.push(root);
    const store = createSessionStore(root, 'zhihu');

    expect(store.getStorageStatePath()).toBe(path.join(root, 'sessions', 'zhihu', 'storage-state.json'));
  });

  it('detects whether storage state exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-session-store-'));
    tempDirs.push(root);
    const store = createSessionStore(root);

    await expect(store.hasStorageState()).resolves.toBe(false);
    await store.ensureDirectories();
    await fs.writeFile(store.getStorageStatePath(), '{}', 'utf8');
    await expect(store.hasStorageState()).resolves.toBe(true);
  });
});
