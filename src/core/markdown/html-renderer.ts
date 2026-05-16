import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Element, ElementContent, Root, RootContent, Text } from 'hast';

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const normalizedMarkdown = normalizeMarkdownForZhihu(markdown);
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(normalizedMarkdown);

  return normalizeZhihuHtml(String(file));
}

function normalizeMarkdownForZhihu(markdown: string): string {
  return markdown
    .replace(/^---$/gm, '──────────')
    .replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, rawLanguage, rawCode) => {
      const language = normalizeCodeLanguage(String(rawLanguage ?? '').trim()).label;
      const code = String(rawCode ?? '').replace(/\n$/, '');
      return [`**${language}**`, '', '```', code, '```'].join('\n');
    });
}

function normalizeZhihuHtml(html: string): string {
  const tree = unified()
    .use(rehypeParse, { fragment: true })
    .parse(html) as Root;

  visit(tree, 'element', (node: Element) => {
    if (!node.tagName) {
      return;
    }

    if (node.tagName === 'hr') {
      node.tagName = 'p';
      node.children = [{ type: 'text', value: '──────────' }];
      return;
    }

    if (node.tagName === 'pre') {
      node.properties = {};
      const codeText = extractNodeText(node).replace(/\n+$/, '');
      node.children = [{
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [createTextNode(codeText)]
      }];
      return;
    }

    if (node.tagName === 'blockquote') {
      node.properties = {
        ...(node.properties ?? {}),
        className: 'blockquote'
      };
      return;
    }

    if (node.tagName === 'table') {
      const asciiTable = buildAsciiTable(node);
      node.tagName = 'pre';
      node.properties = {};
      node.children = [{
        type: 'element',
        tagName: 'code',
        properties: {},
        children: [createTextNode(asciiTable)]
      }];
      return;
    }

    if (node.tagName === 'li') {
      if (node.properties) {
        delete node.properties.className;
      }
      const inputChildIndex = node.children?.findIndex((child) => isElementNode(child) && child.tagName === 'input') ?? -1;
      if (inputChildIndex >= 0 && node.children) {
        const inputNode = node.children[inputChildIndex];
        const checked = isElementNode(inputNode)
          ? Boolean((inputNode.properties as Record<string, unknown> | undefined)?.checked)
          : false;
        node.children.splice(inputChildIndex, 1);
        const firstTextChild = node.children[0];
        if (isTextNode(firstTextChild)) {
          firstTextChild.value = String(firstTextChild.value ?? '').replace(/^\s+/, '');
        }
        node.children.unshift({
          type: 'text',
          value: checked ? '[x] ' : '[ ] '
        });
      }
      return;
    }

    if (node.tagName === 'ul' || node.tagName === 'ol') {
      const ordered = node.tagName === 'ol';
      node.tagName = 'p';
      node.properties = {};
      node.children = buildListParagraphChildren(node, ordered);
    }
  });

  const file = unified()
    .use(rehypeStringify)
    .stringify(tree as Root);

  return String(file);
}

function buildListParagraphChildren(
  listNode: Element,
  ordered: boolean
): ElementContent[] {
  const items = (listNode.children ?? []).filter((child): child is Element => isElementNode(child) && child.tagName === 'li');
  const children: ElementContent[] = [];

  items.forEach((item, index) => {
    const text = extractNodeText(item).replace(/\s+/g, ' ').trim();
    if (!text) {
      return;
    }

    const taskState = getTaskState(item);
    const prefix = ordered
      ? `${index + 1}. `
      : taskState === 'checked'
        ? '[x] '
        : taskState === 'unchecked'
          ? '[ ] '
          : '• ';
    children.push({
      type: 'text',
      value: `${prefix}${text}`
    });

    if (index < items.length - 1) {
      children.push(createBreakNode());
    }
  });

  return children.length > 0 ? children : [createTextNode('')];
}

function buildAsciiTable(tableNode: Element): string {
  const rows = extractTableRows(tableNode);
  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.cells.length));
  const normalizedRows = rows.map((row) => ({
    ...row,
    cells: [...row.cells, ...Array.from({ length: Math.max(0, columnCount - row.cells.length) }, () => '')]
  }));
  const widths = Array.from({ length: columnCount }, (_, index) => {
    return Math.max(...normalizedRows.map((row) => stringWidth(row.cells[index] ?? '')));
  });

  const separator = `+-${widths.map((width) => '-'.repeat(width)).join('-+-')}-+`;
  const lines: string[] = [];

  normalizedRows.forEach((row, index) => {
    if (index === 0) {
      lines.push(separator);
    }
    lines.push(`| ${row.cells.map((cell, cellIndex) => padCell(cell, widths[cellIndex])).join(' | ')} |`);
    if (row.header || index === normalizedRows.length - 1) {
      lines.push(separator);
    }
  });

  return lines.join('\n');
}

function extractTableRows(tableNode: Element): Array<{ cells: string[]; header: boolean }> {
  const rows: Array<{ cells: string[]; header: boolean }> = [];

  for (const section of tableNode.children ?? []) {
    if (!isElementNode(section)) {
      continue;
    }

    const header = section.tagName === 'thead';
    const sectionRows: Array<RootContent | ElementContent> = section.tagName === 'tr'
      ? [section]
      : Array.isArray(section.children)
        ? section.children
        : [];

    for (const row of sectionRows) {
      if (!isElementNode(row) || row.tagName !== 'tr') {
        continue;
      }

      const cells = (row.children ?? [])
        .filter((cell): cell is Element => isElementNode(cell) && (cell.tagName === 'th' || cell.tagName === 'td'))
        .map((cell) => extractNodeText(cell).replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      if (cells.length > 0) {
        rows.push({ cells, header });
      }
    }
  }

  return rows;
}

function extractNodeText(node: RootContent | ElementContent): string {
  if (isTextNode(node)) {
    return String(node.value ?? '');
  }

  if (!isElementNode(node)) {
    return '';
  }

  const children = Array.isArray(node.children) ? node.children : [];
  return children.map((child) => extractNodeText(child)).join('');
}

function getTaskState(node: RootContent | ElementContent): 'checked' | 'unchecked' | null {
  if (!isElementNode(node)) {
    return null;
  }

  const children = Array.isArray(node.children) ? node.children : [];

  for (const child of children) {
    if (isElementNode(child) && child.tagName === 'input') {
      return Boolean((child.properties as Record<string, unknown> | undefined)?.checked) ? 'checked' : 'unchecked';
    }

    const nestedState = getTaskState(child);
    if (nestedState) {
      return nestedState;
    }
  }

  return null;
}

function createBreakNode(): Element {
  return {
    type: 'element',
    tagName: 'br',
    properties: {},
    children: []
  };
}

function createTextNode(value: string): Text {
  return {
    type: 'text',
    value
  };
}

function isElementNode(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && (node as { type?: unknown }).type === 'element';
}

function isTextNode(node: unknown): node is Text {
  return typeof node === 'object' && node !== null && (node as { type?: unknown }).type === 'text';
}

function normalizeCodeLanguage(language: string): { slug: string; label: string } {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return { slug: 'text', label: 'Text' };
  }

  if (normalized === 'ts' || normalized === 'typescript') {
    return { slug: 'typescript', label: 'TypeScript' };
  }

  if (normalized === 'js' || normalized === 'javascript') {
    return { slug: 'javascript', label: 'JavaScript' };
  }

  if (normalized === 'bash' || normalized === 'sh' || normalized === 'shell') {
    return { slug: 'bash', label: 'Bash' };
  }

  if (normalized === 'py' || normalized === 'python') {
    return { slug: 'python', label: 'Python' };
  }

  return {
    slug: normalized,
    label: normalized.charAt(0).toUpperCase() + normalized.slice(1)
  };
}

function stringWidth(value: string): number {
  return Array.from(value).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
}

function padCell(value: string, targetWidth: number): string {
  const padding = Math.max(0, targetWidth - stringWidth(value));
  return value + ' '.repeat(padding);
}
