import { replaceLocalImageUrls } from '../juejin/juejin-payload';
import type { ParsedMarkdownDocument, SyncWarning } from '../types';

interface PreprocessInput {
  doc: ParsedMarkdownDocument;
  uploadedImageMap: Record<string, string>;
  failedImages: string[];
}

export interface PreprocessResult {
  markdown: string;
  warnings: SyncWarning[];
}

export function preprocessMarkdown(input: PreprocessInput): PreprocessResult {
  const withoutFrontmatter = stripFrontmatter(input.doc.rawMarkdown);
  const normalized = normalizeObsidianSyntax(withoutFrontmatter);
  const withDegradedImagePlaceholders = replaceFailedImageSyntax(normalized, input.failedImages);
  const markdownWithUploadedImages = replaceLocalImageUrls(withDegradedImagePlaceholders, input.uploadedImageMap);
  const warnings: SyncWarning[] = [];

  let finalMarkdown = markdownWithUploadedImages;
  if (input.failedImages.length > 0) {
    warnings.push({
      code: 'IMAGE_DEGRADED_TO_TEXT',
      message: `图片未完全同步，已保留原文占位并记录失败清单：${input.failedImages.join(', ')}`
    });
    finalMarkdown = appendFailedImageNote(markdownWithUploadedImages, input.failedImages);
  }

  return {
    markdown: finalMarkdown,
    warnings
  };
}

function normalizeObsidianSyntax(markdown: string): string {
  return markdown.replace(/!\[\[([^[\]]+?)(?:\|([^[\]]+))?\]\]/g, (_match, rawTarget, rawAlt) => {
    const target = String(rawTarget ?? '').trim();
    const alt = String(rawAlt ?? '').trim();
    return `![${alt}](${target})`;
  });
}

function replaceFailedImageSyntax(markdown: string, failedImages: string[]): string {
  return failedImages.reduce((current, image) => {
    const escapedSource = escapeRegExp(image);
    const obsidianPattern = new RegExp(`!\\[\\[\\s*${escapedSource}(?:\\|[^\\]]*)?\\s*\\]\\]`, 'g');
    const markdownImagePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedSource}\\)`, 'g');
    const placeholder = `[图片待补充：${image}]`;

    return current
      .replace(obsidianPattern, placeholder)
      .replace(markdownImagePattern, placeholder);
  }, markdown);
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/, '');
}

function appendFailedImageNote(markdown: string, failedImages: string[]): string {
  const note = [
    '',
    '---',
    '图片同步降级说明：',
    ...failedImages.map((item) => `- ${item}`)
  ].join('\n');

  return `${markdown.trimEnd()}\n${note}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
