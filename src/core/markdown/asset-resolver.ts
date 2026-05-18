import fs from 'node:fs/promises';
import path from 'node:path';

import type { ParsedMarkdownDocument, ResolvedImageReference } from '../types';

export async function resolveImageAssets(doc: ParsedMarkdownDocument): Promise<ResolvedImageReference[]> {
  const baseDir = path.dirname(doc.sourcePath);
  const vaultRoot = await findObsidianVaultRoot(baseDir);
  const attachmentFolderPath = vaultRoot ? await readAttachmentFolderPath(vaultRoot) : null;

  return Promise.all(doc.images.map(async (image) => {
    if (image.kind === 'remote') {
      return image;
    }

    const candidates = buildLocalImageCandidates({
      originalUrl: image.originalUrl,
      baseDir,
      vaultRoot,
      attachmentFolderPath
    });
    const resolvedPath = await findFirstExistingPath(candidates);

    if (!resolvedPath) {
      console.log(
        `[DraftFlow][AssetResolver] NOT FOUND: image=${image.originalUrl} | baseDir=${baseDir} | vaultRoot=${vaultRoot ?? 'null'} | attachmentFolder=${attachmentFolderPath ?? 'null'} | candidates=${JSON.stringify(candidates)}`
      );
    }

    return {
      ...image,
      absolutePath: resolvedPath ?? candidates[0],
      exists: Boolean(resolvedPath)
    };
  }));
}

interface LocalImageCandidateInput {
  originalUrl: string;
  baseDir: string;
  vaultRoot: string | null;
  attachmentFolderPath: string | null;
}

interface ObsidianAppConfig {
  attachmentFolderPath?: string;
}

function buildLocalImageCandidates(input: LocalImageCandidateInput): string[] {
  const candidates = new Set<string>();
  const fileName = path.basename(input.originalUrl);

  candidates.add(path.resolve(input.baseDir, input.originalUrl));

  if (input.vaultRoot) {
    candidates.add(path.resolve(input.vaultRoot, input.originalUrl));
    candidates.add(path.resolve(input.vaultRoot, fileName));
  }

  if (input.attachmentFolderPath) {
    const folder = input.attachmentFolderPath;
    if (folder.startsWith('./')) {
      candidates.add(path.resolve(input.baseDir, folder, fileName));
      candidates.add(path.resolve(input.baseDir, folder, input.originalUrl));
    } else if (input.vaultRoot) {
      candidates.add(path.resolve(input.vaultRoot, folder, fileName));
      candidates.add(path.resolve(input.vaultRoot, folder, input.originalUrl));
    }
  }

  return [...candidates];
}

async function findFirstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Ignore missing candidates and continue probing.
    }
  }

  return null;
}

async function findObsidianVaultRoot(startDir: string): Promise<string | null> {
  let currentDir = startDir;

  while (true) {
    try {
      await fs.access(path.join(currentDir, '.obsidian'));
      return currentDir;
    } catch {
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        return null;
      }
      currentDir = parentDir;
    }
  }
}

async function readAttachmentFolderPath(vaultRoot: string): Promise<string | null> {
  const configPath = path.join(vaultRoot, '.obsidian', 'app.json');

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw) as ObsidianAppConfig;
    const folder = config.attachmentFolderPath?.trim();
    return folder ? folder : null;
  } catch {
    return null;
  }
}
