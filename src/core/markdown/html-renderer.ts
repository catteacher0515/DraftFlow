import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Element, ElementContent, Root, RootContent, Text } from 'hast';

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown);

  return normalizeZhihuHtml(String(file));
}

function normalizeZhihuHtml(html: string): string {
  const tree = unified()
    .use(rehypeParse, { fragment: true })
    .parse(html) as Root;

  visit(tree, 'element', (node: Element) => {
    if (!node.tagName) {
      return;
    }

    if (node.tagName === 'pre') {
      const codeChild = node.children?.find((child): child is Element => isElementNode(child) && child.tagName === 'code');
      const className = codeChild?.properties?.className;
      const rawLanguage = Array.isArray(className)
        ? String(className.find((item) => String(item).startsWith('language-')) ?? '').replace('language-', '')
        : '';
      const language = normalizeCodeLanguage(rawLanguage);
      const codeText = extractNodeText(node).replace(/\n+$/, '');

      node.properties = { lang: language.slug };
      node.children = [{
        type: 'element',
        tagName: 'code',
        properties: { className: [`language-${language.slug}`] },
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
      const rows: Element[] = [];
      for (const section of node.children ?? []) {
        if (!isElementNode(section)) continue;
        if (section.tagName === 'thead' || section.tagName === 'tbody') {
          for (const row of section.children ?? []) {
            if (isElementNode(row) && row.tagName === 'tr') {
              rows.push(row);
            }
          }
        } else if (section.tagName === 'tr') {
          rows.push(section);
        }
      }
      node.properties = {
        'dataDraftNode': 'block',
        'dataDraftType': 'table',
        'dataSize': 'normal'
      };
      node.children = [{
        type: 'element',
        tagName: 'tbody',
        properties: {},
        children: rows
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
