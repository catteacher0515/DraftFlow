import fs from 'node:fs/promises';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';

import type { ParsedImageReference, ParsedMarkdownDocument } from '../types';

interface HeadingNode {
  type?: string;
  depth?: number;
  children?: NodeChild[];
}

interface ImageNode {
  alt?: string;
  url?: string;
  position?: { start?: { line?: number } };
}

interface ParagraphNode {
  type?: string;
  children?: NodeChild[];
}

interface ListItemNode {
  type?: string;
  children?: NodeChild[];
}

interface TextNode {
  type?: string;
  value?: string;
  children?: NodeChild[];
}

type NodeChild = TextNode;
const OBSIDIAN_IMAGE_PATTERN = /!\[\[([^[\]]+)\]\]/g;

export async function parseMarkdownDocument(sourcePath: string): Promise<ParsedMarkdownDocument> {
  const rawMarkdown = await fs.readFile(sourcePath, 'utf8');
  return parseMarkdownContent(sourcePath, rawMarkdown);
}

export function parseMarkdownContent(sourcePath: string, rawMarkdown: string): ParsedMarkdownDocument {
  const tree = unified().use(remarkParse).parse(rawMarkdown);

  const images: ParsedImageReference[] = collectObsidianImages(rawMarkdown);
  let extractedTitle: string | null = null;
  let fallbackTitle: string | null = null;

  visit(tree, (node) => {
    if (node.type === 'heading' && extractedTitle === null) {
      const heading = node as HeadingNode;
      if (heading.depth === 1) {
        extractedTitle = stringifyNodeText(heading).trim() || null;
      }
    }

    if (fallbackTitle === null && node.type === 'listItem') {
      fallbackTitle = normalizeTitleCandidate(stringifyNodeText(node as ParagraphNode | ListItemNode));
    }

    if (node.type === 'image') {
      const image = node as ImageNode;
      const url = image.url ?? '';
      images.push({
        alt: image.alt ?? '',
        originalUrl: url,
        kind: isRemoteUrl(url) ? 'remote' : 'local',
        line: image.position?.start?.line
      });
    }
  });

  return {
    sourcePath,
    rawMarkdown,
    extractedTitle: extractedTitle ?? fallbackTitle,
    images
  };
}

export function resolveFinalTitle(manualTitle: string | undefined, extractedTitle: string | null): string {
  const trimmedManual = manualTitle?.trim();
  if (trimmedManual) {
    return trimmedManual;
  }

  return extractedTitle?.trim() ?? '';
}

function stringifyNodeText(node: HeadingNode): string {
  return (node.children ?? [])
    .map((child) => {
      if (typeof child.value === 'string') {
        return child.value;
      }

      return (child.children ?? []).map((nested) => nested.value ?? '').join('');
    })
    .join('');
}

function normalizeTitleCandidate(value: string): string | null {
  const trimmed = value
    .replace(/\[\[[^\]]+\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return trimmed ? trimmed : null;
}

function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function collectObsidianImages(markdown: string): ParsedImageReference[] {
  const images: ParsedImageReference[] = [];
  const lines = markdown.split('\n');

  lines.forEach((line, index) => {
    const matches = line.matchAll(OBSIDIAN_IMAGE_PATTERN);
    for (const match of matches) {
      const rawTarget = match[1]?.trim();
      if (!rawTarget) {
        continue;
      }

      const normalized = rawTarget.split('|')[0]?.trim();
      if (!normalized) {
        continue;
      }

      images.push({
        alt: '',
        originalUrl: normalized,
        kind: isRemoteUrl(normalized) ? 'remote' : 'local',
        line: index + 1
      });
    }
  });

  return images;
}
