import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseMarkdownDocument, resolveFinalTitle } from '../src/core/markdown/markdown-parser';
import { resolveImageAssets } from '../src/core/markdown/asset-resolver';

const fixturePath = path.resolve('tests/fixtures/sample-article.md');
const listNoteFixturePath = path.resolve('tests/fixtures/list-note.md');

describe('markdown parser', () => {
  it('extracts the first heading as title', async () => {
    const doc = await parseMarkdownDocument(fixturePath);

    expect(doc.extractedTitle).toBe('DraftFlow MVP');
  });

  it('classifies local and remote images', async () => {
    const doc = await parseMarkdownDocument(fixturePath);

    expect(doc.images).toHaveLength(2);
    expect(doc.images[0]).toMatchObject({
      alt: '本地图片',
      originalUrl: './local-image.png',
      kind: 'local'
    });
    expect(doc.images[1]).toMatchObject({
      alt: '远程图片',
      originalUrl: 'https://example.com/hero.png',
      kind: 'remote'
    });
  });

  it('prefers manual title over extracted title', async () => {
    const doc = await parseMarkdownDocument(fixturePath);

    expect(resolveFinalTitle('手动标题', doc.extractedTitle)).toBe('手动标题');
    expect(resolveFinalTitle('', doc.extractedTitle)).toBe('DraftFlow MVP');
  });

  it('falls back to the first list item when no h1 exists', async () => {
    const doc = await parseMarkdownDocument(listNoteFixturePath);

    expect(doc.extractedTitle).toBe('口播邪修');
    expect(resolveFinalTitle('', doc.extractedTitle)).toBe('口播邪修');
  });

  it('collects obsidian wiki images as local images', async () => {
    const doc = await parseMarkdownDocument(listNoteFixturePath);

    expect(doc.images).toContainEqual({
      alt: '',
      originalUrl: 'Pasted image 20260515150949.png',
      kind: 'local',
      line: 7
    });
  });

  it('resolves local image absolute paths', async () => {
    const doc = await parseMarkdownDocument(fixturePath);
    const assets = await resolveImageAssets(doc);

    expect(assets[0].absolutePath).toBe(path.resolve('tests/fixtures/local-image.png'));
    expect(assets[0].exists).toBe(false);
    expect(assets[1].absolutePath).toBeUndefined();
  });

  it('resolves obsidian wiki images from the vault root', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-obsidian-vault-'));
    const vaultRoot = path.join(tempRoot, 'Vault');
    const notesDir = path.join(vaultRoot, 'notes', 'week');
    await fs.mkdir(path.join(vaultRoot, '.obsidian'), { recursive: true });
    await fs.mkdir(notesDir, { recursive: true });
    await fs.writeFile(path.join(vaultRoot, '.obsidian', 'app.json'), '{}', 'utf8');
    await fs.writeFile(path.join(vaultRoot, 'Pasted image 20260515150949.png'), 'png', 'utf8');

    const notePath = path.join(notesDir, 'list-note.md');
    await fs.writeFile(notePath, '1. 标题\n\n![[Pasted image 20260515150949.png]]\n', 'utf8');

    const doc = await parseMarkdownDocument(notePath);
    const assets = await resolveImageAssets(doc);

    expect(assets[0].absolutePath).toBe(path.join(vaultRoot, 'Pasted image 20260515150949.png'));
    expect(assets[0].exists).toBe(true);

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('resolves obsidian wiki images from a common vault attachment subfolder when app config is unset', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'draftflow-obsidian-vault-'));
    const vaultRoot = path.join(tempRoot, 'Vault');
    const imageDir = path.join(vaultRoot, '图片');
    await fs.mkdir(path.join(vaultRoot, '.obsidian'), { recursive: true });
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(path.join(vaultRoot, '.obsidian', 'app.json'), '{}', 'utf8');
    await fs.writeFile(path.join(imageDir, 'Pasted image 20260516101305.png'), 'png', 'utf8');

    const notePath = path.join(vaultRoot, 'DraftFlow Zhihu 格式回归测试.md');
    await fs.writeFile(notePath, '1. 标题\n\n![[Pasted image 20260516101305.png]]\n', 'utf8');

    const doc = await parseMarkdownDocument(notePath);
    const assets = await resolveImageAssets(doc);

    expect(assets[0].absolutePath).toBe(path.join(imageDir, 'Pasted image 20260516101305.png'));
    expect(assets[0].exists).toBe(true);

    await fs.rm(tempRoot, { recursive: true, force: true });
  });
});
