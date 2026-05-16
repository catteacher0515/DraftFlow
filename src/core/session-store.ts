import fs from 'node:fs/promises';
import path from 'node:path';

interface SessionStore {
  getStorageStatePath(): string;
  ensureDirectories(): Promise<void>;
  hasStorageState(): Promise<boolean>;
}

export function createSessionStore(rootDir: string, platform = 'juejin'): SessionStore {
  const dir = path.join(rootDir, 'sessions', platform);
  const filePath = path.join(dir, 'storage-state.json');

  return {
    getStorageStatePath() {
      return filePath;
    },
    async ensureDirectories() {
      await fs.mkdir(dir, { recursive: true });
    },
    async hasStorageState() {
      try {
        await fs.access(filePath);
        return true;
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          return false;
        }
        throw error;
      }
    }
  };
}
