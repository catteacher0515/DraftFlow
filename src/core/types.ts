export type Platform = 'juejin' | 'zhihu';
export type ImageKind = 'local' | 'remote';

export interface ParsedImageReference {
  alt: string;
  originalUrl: string;
  kind: ImageKind;
  line?: number;
}

export interface ParsedMarkdownDocument {
  sourcePath: string;
  rawMarkdown: string;
  extractedTitle: string | null;
  images: ParsedImageReference[];
}

export interface ResolvedImageReference extends ParsedImageReference {
  absolutePath?: string;
  exists?: boolean;
}

export interface SyncRequest {
  sourcePath: string;
  manualTitle?: string;
  platform: Platform;
  sourceMarkdown?: string;
}

export interface SyncWarning {
  code: string;
  message: string;
}

export interface SyncResult {
  status: 'success' | 'partial_success' | 'failure';
  platform: Platform;
  sourceFile: string;
  title: string;
  draftId?: string;
  draftUrl?: string;
  uploadedImageCount: number;
  failedImages: string[];
  warnings: SyncWarning[];
  errorMessage?: string;
  finishedAt: string;
}

export interface TaskSnapshot {
  taskId: string;
  platform: Platform;
  sourceFile: string;
  manualTitle?: string;
  snapshotPath: string;
  createdAt: string;
}

export interface RetryTaskRequest {
  taskId: string;
}

export interface TaskHistoryEntry extends SyncResult {
  taskId: string;
  startedAt: string;
  manualTitle?: string;
  snapshotPath?: string;
  retryOfTaskId?: string;
}
