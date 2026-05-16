import fs from 'node:fs/promises';
import path from 'node:path';

import type { TaskHistoryEntry, TaskSnapshot } from './types';

interface TaskStore {
  append(entry: TaskHistoryEntry): Promise<void>;
  list(): Promise<TaskHistoryEntry[]>;
  saveSnapshot(snapshot: TaskSnapshot, content: string): Promise<void>;
  getSnapshot(taskId: string): Promise<{ meta: TaskSnapshot; content: string } | null>;
  buildSnapshotPath(taskId: string): string;
}

const HISTORY_FILE = path.join('tasks', 'history.json');
const SNAPSHOT_DIR = path.join('tasks', 'snapshots');

export function createTaskStore(rootDir: string): TaskStore {
  const filePath = path.join(rootDir, HISTORY_FILE);
  const snapshotDir = path.join(rootDir, SNAPSHOT_DIR);

  return {
    async append(entry) {
      const history = await readHistory(filePath);
      history.push(entry);
      await ensureParentDir(filePath);
      await fs.writeFile(filePath, JSON.stringify(history, null, 2), 'utf8');
    },
    async list() {
      const history = await readHistory(filePath);
      return history.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
    },
    async saveSnapshot(snapshot, content) {
      const snapshotMetaPath = path.join(snapshotDir, `${snapshot.taskId}.json`);
      await ensureParentDir(snapshotMetaPath);
      await fs.writeFile(snapshotMetaPath, JSON.stringify(snapshot, null, 2), 'utf8');
      await fs.writeFile(snapshot.snapshotPath, content, 'utf8');
    },
    async getSnapshot(taskId) {
      const snapshotMetaPath = path.join(snapshotDir, `${taskId}.json`);

      try {
        const rawMeta = await fs.readFile(snapshotMetaPath, 'utf8');
        const meta = JSON.parse(rawMeta) as TaskSnapshot;
        const content = await fs.readFile(meta.snapshotPath, 'utf8');
        return { meta, content };
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    buildSnapshotPath(taskId) {
      return path.join(snapshotDir, `${taskId}.md`);
    }
  };
}

async function readHistory(filePath: string): Promise<TaskHistoryEntry[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as TaskHistoryEntry[];
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
