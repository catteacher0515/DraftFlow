import { contextBridge, ipcRenderer } from 'electron';
import type { Platform, RetryTaskRequest, SyncResult, TaskHistoryEntry } from './core/types';

contextBridge.exposeInMainWorld('draftflow', {
  pickMarkdownFile: () => ipcRenderer.invoke('dialog:pick-markdown') as Promise<string | null>,
  syncToPlatform: (payload: { sourcePath: string; manualTitle?: string; platform: Platform }) =>
    ipcRenderer.invoke('sync:platform', payload) as Promise<SyncResult>,
  listTaskHistory: () => ipcRenderer.invoke('tasks:list-history') as Promise<TaskHistoryEntry[]>,
  retryTask: (payload: RetryTaskRequest) => ipcRenderer.invoke('tasks:retry', payload) as Promise<SyncResult>
});
