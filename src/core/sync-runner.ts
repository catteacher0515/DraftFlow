import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { resolveImageAssets } from './markdown/asset-resolver';
import { parseMarkdownContent, parseMarkdownDocument, resolveFinalTitle } from './markdown/markdown-parser';
import { preprocessMarkdown } from './markdown/preprocess';
import { buildJuejinDraftPayload, replaceLocalImageUrls } from './juejin/juejin-payload';
import type { SyncRequest, SyncResult, SyncWarning, TaskHistoryEntry, TaskSnapshot } from './types';
import { createTaskStore } from './task-store';

interface SyncDependencies {
  uploadLocalImage?: (absolutePath: string) => Promise<string>;
  manageImagesInDraft?: boolean;
  createDraft: (payload: {
    title: string;
    mark_content: string;
    localImageMap?: Record<string, string>;
  }) => Promise<{
    draftId: string;
    draftUrl: string;
    uploadedImages?: string[];
    failedImages?: string[];
    warnings?: SyncWarning[];
  }>;
  rootDir?: string;
  retryOfTaskId?: string;
  sourceMarkdown?: string;
}

export async function runSync(request: SyncRequest, deps: SyncDependencies): Promise<SyncResult> {
  const taskId = createTaskId();
  const startedAt = new Date().toISOString();
  const rawMarkdown = deps.sourceMarkdown ?? request.sourceMarkdown;
  const doc = rawMarkdown === undefined
    ? await parseMarkdownDocument(request.sourcePath)
    : parseMarkdownContent(request.sourcePath, rawMarkdown);
  const title = resolveFinalTitle(request.manualTitle, doc.extractedTitle);
  const warnings: SyncWarning[] = [];
  const failedImages: string[] = [];
  const replacements: Record<string, string> = {};
  const localImageMap: Record<string, string> = {};
  const taskStore = deps.rootDir ? createTaskStore(deps.rootDir) : null;

  if (!title) {
    const failedResult: SyncResult = {
      status: 'failure',
      platform: request.platform,
      sourceFile: request.sourcePath,
      title: '',
      uploadedImageCount: 0,
      failedImages: [],
      warnings: [],
      errorMessage: 'title is required',
      finishedAt: new Date().toISOString()
    };

    await persistTaskArtifacts(taskStore, {
      taskId,
      request,
      title: '',
      startedAt,
      result: failedResult,
      snapshotContent: doc.rawMarkdown,
      retryOfTaskId: deps.retryOfTaskId
    });
    return failedResult;
  }

  const resolvedImages = await resolveImageAssets(doc);

  for (const image of resolvedImages) {
    if (image.kind !== 'local' || !image.absolutePath) {
      continue;
    }

    if (!image.exists) {
      failedImages.push(image.originalUrl);
      warnings.push({
        code: 'LOCAL_IMAGE_UPLOAD_FAILED',
        message: `${image.originalUrl}: ENOENT: no such file or directory, open '${image.absolutePath}'`
      });
      continue;
    }

    if (deps.manageImagesInDraft) {
      localImageMap[image.originalUrl] = image.absolutePath;
      continue;
    }

    try {
      if (!deps.uploadLocalImage) {
        throw new Error('PLATFORM_IMAGE_UPLOAD_UNAVAILABLE');
      }
      replacements[image.originalUrl] = await deps.uploadLocalImage(image.absolutePath);
    } catch (error) {
      failedImages.push(image.originalUrl);
      const message = (error as Error).message;
      warnings.push({
        code: message === 'PLATFORM_IMAGE_UPLOAD_UNAVAILABLE'
          ? 'PLATFORM_IMAGE_UPLOAD_UNAVAILABLE'
          : 'LOCAL_IMAGE_UPLOAD_FAILED',
        message: message === 'PLATFORM_IMAGE_UPLOAD_UNAVAILABLE'
          ? `${image.originalUrl}: current platform sync will keep text draft first and mark this image for manual completion`
          : `${image.originalUrl}: ${message}`
      });
    }
  }

  const preprocessResult = preprocessMarkdown({
    doc,
    uploadedImageMap: replacements,
    failedImages
  });
  warnings.push(...preprocessResult.warnings);

  const finalMarkdown = preprocessResult.markdown;
  const payload = buildJuejinDraftPayload({
    title,
    markdown: finalMarkdown,
    categoryId: '0'
  });
  const draft = await deps.createDraft({
    title: payload.title,
    mark_content: payload.mark_content,
    localImageMap: deps.manageImagesInDraft ? localImageMap : undefined
  });

  const draftFailedImages = draft.failedImages ?? [];
  const draftWarnings = draft.warnings ?? [];
  failedImages.push(...draftFailedImages);
  warnings.push(...draftWarnings);
  const uploadedImageCount = deps.manageImagesInDraft
    ? draft.uploadedImages?.length ?? 0
    : Object.keys(replacements).length;

  const result: SyncResult = {
    status: failedImages.length > 0 ? 'partial_success' : 'success',
    platform: request.platform,
    sourceFile: request.sourcePath,
    title,
    draftId: draft.draftId,
    draftUrl: draft.draftUrl,
    uploadedImageCount,
    failedImages,
    warnings,
    finishedAt: new Date().toISOString()
  };

  await persistTaskArtifacts(taskStore, {
    taskId,
    request,
    title,
    startedAt,
      result,
      snapshotContent: doc.rawMarkdown,
      retryOfTaskId: deps.retryOfTaskId
  });

  return result;
}

export function createTaskId(): string {
  return randomUUID();
}

interface PersistTaskArtifactsInput {
  taskId: string;
  request: SyncRequest;
  title: string;
  startedAt: string;
  result: SyncResult;
  snapshotContent: string;
  retryOfTaskId?: string;
}

async function persistTaskArtifacts(
  taskStore: ReturnType<typeof createTaskStore> | null,
  input: PersistTaskArtifactsInput
): Promise<void> {
  if (!taskStore) {
    return;
  }

  const snapshot: TaskSnapshot = {
    taskId: input.taskId,
    platform: input.request.platform,
    sourceFile: input.request.sourcePath,
    manualTitle: input.request.manualTitle,
    snapshotPath: taskStore.buildSnapshotPath(input.taskId),
    createdAt: input.startedAt
  };

  await taskStore.saveSnapshot(snapshot, input.snapshotContent);

  const entry: TaskHistoryEntry = {
    taskId: input.taskId,
    startedAt: input.startedAt,
    manualTitle: input.request.manualTitle,
    snapshotPath: snapshot.snapshotPath,
    retryOfTaskId: input.retryOfTaskId,
    ...input.result
  };
  await taskStore.append(entry);
}
