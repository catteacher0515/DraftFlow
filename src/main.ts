import path from 'node:path';
import { fileURLToPath } from 'node:url';

import electron from 'electron';

import { createJuejinAdapter } from './core/juejin/juejin-adapter';
import { createZhihuAdapter } from './core/zhihu/zhihu-adapter';
import { parseMarkdownDocument, resolveFinalTitle } from './core/markdown/markdown-parser';
import { runSync } from './core/sync-runner';
import { createTaskStore } from './core/task-store';
import type { Platform, RetryTaskRequest, SyncRequest } from './core/types';

const { app, BrowserWindow, dialog, ipcMain } = electron;

function createWindow(): void {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const preloadPath = path.resolve(currentDir, '../preload/preload.cjs');

  const window = new BrowserWindow({
    width: 980,
    height: 720,
    webPreferences: {
      preload: preloadPath
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(new URL('../renderer/index.html', import.meta.url).pathname);
  }
}

app.whenReady().then(() => {
  const rootDir = app.getPath('userData');
  const taskStore = createTaskStore(rootDir);

  ipcMain.handle('dialog:pick-markdown', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('sync:platform', async (_event, payload: { sourcePath: string; manualTitle?: string; platform: Platform }) => {
    const document = await parseMarkdownDocument(payload.sourcePath);
    const resolvedTitle = resolveFinalTitle(payload.manualTitle, document.extractedTitle);

    if (!resolvedTitle) {
      return {
        status: 'failure',
        platform: payload.platform,
        sourceFile: payload.sourcePath,
        title: '',
        uploadedImageCount: 0,
        failedImages: [],
        warnings: [],
        errorMessage: '当前 Markdown 没有一级标题（# 标题），请填写“手动标题”后再同步。',
        finishedAt: new Date().toISOString()
      };
    }

    return runPlatformSync(rootDir, {
      sourcePath: payload.sourcePath,
      manualTitle: payload.manualTitle,
      platform: payload.platform
    });
  });

  ipcMain.handle('tasks:list-history', async () => taskStore.list());

  ipcMain.handle('tasks:retry', async (_event, payload: RetryTaskRequest) => {
    const snapshot = await taskStore.getSnapshot(payload.taskId);
    if (!snapshot) {
      throw new Error(`Task snapshot not found: ${payload.taskId}`);
    }

    return runPlatformSync(rootDir, {
      sourcePath: snapshot.meta.sourceFile,
      manualTitle: snapshot.meta.manualTitle,
      platform: snapshot.meta.platform,
      sourceMarkdown: snapshot.content
    }, payload.taskId);
  });

  createWindow();
}).catch((error) => {
  console.error('app bootstrap failed', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('unhandledRejection', (error) => {
  console.error('unhandled rejection', error);
});

async function runPlatformSync(rootDir: string, request: SyncRequest, retryOfTaskId?: string) {
  switch (request.platform) {
    case 'juejin':
      return runJuejinSync(rootDir, request, retryOfTaskId);
    case 'zhihu':
      return runZhihuSync(rootDir, request, retryOfTaskId);
    default:
      throw new Error(`Unsupported platform: ${String((request as SyncRequest).platform)}`);
  }
}

async function runJuejinSync(rootDir: string, request: SyncRequest, retryOfTaskId?: string) {
  const adapter = await createJuejinAdapter(rootDir);

  try {
    await adapter.ensureAuthenticated();
    return await runSync(
      request,
      {
        rootDir,
        retryOfTaskId,
        sourceMarkdown: request.sourceMarkdown,
        uploadLocalImage: (absolutePath) => adapter.uploadLocalImage(absolutePath),
        createDraft: (draftPayload) => adapter.createDraft(draftPayload)
      }
    );
  } finally {
    await adapter.close();
  }
}

async function runZhihuSync(rootDir: string, request: SyncRequest, retryOfTaskId?: string) {
  const adapter = await createZhihuAdapter(rootDir);

  try {
    await adapter.ensureAuthenticated();
    return await runSync(
      request,
      {
        rootDir,
        retryOfTaskId,
        sourceMarkdown: request.sourceMarkdown,
        manageImagesInDraft: true,
        createDraft: (draftPayload) => adapter.createDraft(draftPayload)
      }
    );
  } finally {
    await adapter.close();
  }
}
