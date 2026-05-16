import fs from 'node:fs/promises';

import { chromium, type BrowserContext, type Page } from 'playwright';

import { renderMarkdownToHtml } from '../markdown/html-renderer';
import { createSessionStore } from '../session-store';

export interface ZhihuAdapter {
  ensureAuthenticated(): Promise<void>;
  createDraft(payload: {
    title: string;
    mark_content: string;
    localImageMap?: Record<string, string>;
  }): Promise<{
    draftId: string;
    draftUrl: string;
    uploadedImages: string[];
    failedImages: string[];
    warnings: Array<{ code: string; message: string }>;
  }>;
  close(): Promise<void>;
}

const ZHIHU_CREATOR_URL = 'https://www.zhihu.com/creator';
const ZHIHU_WRITE_URL = 'https://zhuanlan.zhihu.com/write';
const ZHIHU_SIGNIN_URL = 'https://www.zhihu.com/signin?next=https%3A%2F%2Fzhuanlan.zhihu.com%2Fwrite';
const ZHIHU_MAIN_EDITOR_SELECTOR = '.public-DraftEditor-content[contenteditable="true"]';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_POLL_INTERVAL_MS = 1_000;
const NAVIGATION_TIMEOUT_MS = 15_000;

export async function createZhihuAdapter(rootDir: string): Promise<ZhihuAdapter> {
  const sessionStore = createSessionStore(rootDir, 'zhihu');
  await sessionStore.ensureDirectories();

  const context = await launchBrowserContext(`${rootDir}/sessions/zhihu/user-data`);
  let page = await ensurePage(context);

  return {
    async ensureAuthenticated() {
      logZhihu('checking authentication');
      await navigateForAuth(page);
      let authenticated = await isAuthenticated(page);

      if (!authenticated) {
        logZhihu('login required, opening login page');
        await safeGoto(page, ZHIHU_SIGNIN_URL);
        await page.bringToFront();

        const loggedIn = await waitForAuthentication(context, LOGIN_TIMEOUT_MS);
        if (!loggedIn) {
          throw new Error('Zhihu login timed out after 5 minutes. Please complete login faster and retry.');
        }

        logZhihu('login detected, reopening editor');
        page = await ensurePage(context);
        authenticated = await waitForAuthenticationReady(page, 30_000);
      }

      if (!authenticated) {
        throw new Error('Zhihu authentication probe still failed after login redirect.');
      }

      await context.storageState({ path: sessionStore.getStorageStatePath() });
      logZhihu('authentication ready');
    },
    async createDraft(payload) {
      logZhihu(`creating draft via api automation: ${payload.title}`);
      page = await openEditor(page);

      const imageResult = await resolveMarkdownToZhihuHtml(page, payload.mark_content, payload.localImageMap ?? {});
      const draft = await saveDraftViaApi(page, payload.title, imageResult.html);
      logZhihu(`draft created: ${draft.draftId}`);

      return {
        draftId: draft.draftId,
        draftUrl: draft.draftUrl,
        uploadedImages: imageResult.uploadedImages,
        failedImages: imageResult.failedImages,
        warnings: imageResult.warnings
      };
    },
    async close() {
      await context.close();
    }
  };
}

interface LaunchAttempt {
  label: string;
  options: Parameters<typeof chromium.launchPersistentContext>[1];
}

type MarkdownBlock =
  | { type: 'text'; value: string }
  | { type: 'image'; originalUrl: string };

async function launchBrowserContext(userDataDir: string): Promise<BrowserContext> {
  const attempts = await buildLaunchAttempts();
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        ...attempt.options
      });
    } catch (error) {
      errors.push(`${attempt.label}: ${toErrorMessage(error)}`);
    }
  }

  throw new Error(
    [
      'DraftFlow could not start a Chromium-compatible browser for Zhihu sync.',
      'Tried these launch strategies:',
      ...errors.map((item) => `- ${item}`),
      'Fix options:',
      '- Install Google Chrome in /Applications, or',
      '- Set DRAFTFLOW_CHROME_EXECUTABLE to a valid Chrome/Chromium executable path, or',
      '- Run `npx playwright install chromium` to install Playwright managed Chromium.'
    ].join('\n')
  );
}

async function buildLaunchAttempts(): Promise<LaunchAttempt[]> {
  const attempts: LaunchAttempt[] = [];
  const seen = new Set<string>();
  const envExecutable = process.env.DRAFTFLOW_CHROME_EXECUTABLE;

  async function addExecutableAttempt(executablePath: string, label: string): Promise<void> {
    if (seen.has(executablePath)) {
      return;
    }

    try {
      await fs.access(executablePath);
      attempts.push({
        label,
        options: { executablePath }
      });
      seen.add(executablePath);
    } catch {
      // Skip paths that do not exist on this machine.
    }
  }

  if (envExecutable) {
    await addExecutableAttempt(envExecutable, `env executable ${envExecutable}`);
  }

  if (process.platform === 'darwin') {
    await addExecutableAttempt(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      'system Google Chrome'
    );
    await addExecutableAttempt(
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      'system Chromium'
    );
  }

  attempts.push({
    label: 'Playwright chrome channel',
    options: { channel: 'chrome' }
  });
  attempts.push({
    label: 'Playwright bundled chromium',
    options: {}
  });

  return attempts;
}

async function ensurePage(context: BrowserContext): Promise<Page> {
  const existing = context.pages()[0];
  if (existing) {
    return existing;
  }
  return context.newPage();
}

async function navigateForAuth(page: Page): Promise<void> {
  try {
    await safeGoto(page, ZHIHU_CREATOR_URL);
  } catch (error) {
    logZhihu(`creator page navigation failed, fallback to write page: ${toErrorMessage(error)}`);
    await safeGoto(page, ZHIHU_WRITE_URL);
  }
}

async function safeGoto(page: Page, url: string): Promise<void> {
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS
  });
}

async function isAuthenticated(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/signin')) {
    logZhihu(`auth probe: redirected to signin ${url}`);
    return false;
  }

  const probe = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? '';
    const hasLoginPrompt = bodyText.includes('登录/注册') || bodyText.includes('验证码登录');
    const hasEditorHint = bodyText.includes('写文章') || bodyText.includes('发布') || bodyText.includes('保存');
    const titleLikeInput =
      Boolean(document.querySelector('textarea')) ||
      Boolean(document.querySelector('input[placeholder*="标题"]')) ||
      Boolean(document.querySelector('[contenteditable="true"]'));

    return {
      hasLoginPrompt,
      hasEditorHint,
      titleLikeInput
    };
  });

  const authenticated = !probe.hasLoginPrompt && (probe.hasEditorHint || probe.titleLikeInput);
  logZhihu(`auth probe: url=${url}; editorHint=${probe.hasEditorHint}; titleLikeInput=${probe.titleLikeInput}; loginPrompt=${probe.hasLoginPrompt}`);
  return authenticated;
}

async function waitForAuthentication(context: BrowserContext, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    const page = await ensurePage(context);
    if (await isAuthenticated(page)) {
      logZhihu(`login confirmed after ${attempts} auth checks`);
      return true;
    }

    if (attempts === 1 || attempts % 10 === 0) {
      logZhihu(`waiting for login... attempt ${attempts}; currentUrl=${page.url()}`);
    }

    await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  }

  return false;
}

async function openEditor(page: Page): Promise<Page> {
  const editorPage = await page.context().newPage();
  await editorPage.bringToFront().catch(() => undefined);
  await safeGoto(editorPage, ZHIHU_WRITE_URL);
  await editorPage.waitForLoadState('networkidle').catch(() => undefined);
  const ready = await waitForEditorReady(editorPage, 30_000);
  if (!ready) {
    throw new Error(`Zhihu editor did not become ready after opening write page. ${await collectEditorDiagnostics(editorPage)}`);
  }

  return editorPage;
}

async function resolveMarkdownToZhihuHtml(
  page: Page,
  markdown: string,
  localImageMap: Record<string, string>
): Promise<{
  html: string;
  uploadedImages: string[];
  failedImages: string[];
  warnings: Array<{ code: string; message: string }>;
}> {
  const uploadedImages: string[] = [];
  const failedImages: string[] = [];
  const warnings: Array<{ code: string; message: string }> = [];
  const localImageHtmlMap = new Map<string, string>();

  for (const [originalUrl, absolutePath] of Object.entries(localImageMap)) {
    try {
      const imageHtml = await uploadImageAndGetHtml(page, absolutePath);
      localImageHtmlMap.set(originalUrl, imageHtml);
      uploadedImages.push(originalUrl);
    } catch (error) {
      failedImages.push(originalUrl);
      warnings.push({
        code: 'LOCAL_IMAGE_UPLOAD_FAILED',
        message: `${originalUrl}: ${toErrorMessage(error)}`
      });
    }
  }

  let html = '';
  const blocks = splitMarkdownIntoBlocks(markdown);

  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.value.trim()) {
        html += await renderMarkdownToHtml(block.value);
      }
      continue;
    }

    const localImageHtml = localImageHtmlMap.get(block.originalUrl);
    if (localImageHtml) {
      html += localImageHtml;
      continue;
    }

    failedImages.push(block.originalUrl);
    warnings.push({
      code: 'PLATFORM_IMAGE_UPLOAD_UNAVAILABLE',
      message: `${block.originalUrl}: current platform sync will keep text draft first and mark this image for manual completion`
    });
    html += `<p>${escapeHtml(`[图片待补充：${block.originalUrl}]`)}</p>`;
  }

  const uniqueFailedImages = Array.from(new Set(failedImages));
  const filteredWarnings = warnings.filter((warning, index) => {
    const duplicateIndex = warnings.findIndex((candidate) => candidate.code === warning.code && candidate.message === warning.message);
    return duplicateIndex === index;
  });

  if (uniqueFailedImages.length > 0) {
    filteredWarnings.push({
      code: 'IMAGE_DEGRADED_TO_TEXT',
      message: `图片未完全同步，已保留原文占位并记录失败清单：${uniqueFailedImages.join(', ')}`
    });
  }

  return {
    html,
    uploadedImages,
    failedImages: uniqueFailedImages,
    warnings: filteredWarnings
  };
}

async function uploadImageAndGetHtml(page: Page, absolutePath: string): Promise<string> {
  const editor = page.locator(ZHIHU_MAIN_EDITOR_SELECTOR).first();
  if (!(await editor.count())) {
    throw new Error(`Zhihu editor body not found. ${await collectEditorDiagnostics(page)}`);
  }

  await editor.click({ timeout: 10_000 });
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
  await page.keyboard.press('Backspace');
  await uploadImageIntoEditor(page, absolutePath);
  await page.waitForTimeout(500);

  const html = await page.evaluate((selector) => {
    const editor = document.querySelector(selector) as HTMLElement | null;
    return editor?.innerHTML ?? '';
  }, ZHIHU_MAIN_EDITOR_SELECTOR);

  if (!html.includes('<figure')) {
    throw new Error('Zhihu image upload did not produce a figure block');
  }

  return html;
}

async function uploadImageIntoEditor(page: Page, absolutePath: string): Promise<void> {
  logZhihu(`uploading local image: ${absolutePath}`);

  const beforeCount = await page.locator('img[src*="pic"]').count();
  const fileInput = page.locator('input[type="file"][accept*="image"]').first();
  if (!(await fileInput.count())) {
    throw new Error(`Zhihu image input not found. ${await collectEditorDiagnostics(page)}`);
  }

  await fileInput.setInputFiles(absolutePath);

  await page.waitForFunction(
    (previousCount) => {
      const images = Array.from(document.querySelectorAll('img'));
      const uploadedCount = images.filter((node) => {
        const src = node.getAttribute('src') ?? '';
        return src.includes('pic-private.zhihu.com') || src.includes('zhimg.com');
      }).length;
      const uploading = document.body?.innerText?.includes('图片上传中');
      return uploadedCount > previousCount && !uploading;
    },
    beforeCount,
    { timeout: 60_000 }
  );
}

async function saveDraftViaApi(
  page: Page,
  title: string,
  html: string
): Promise<{ draftId: string; draftUrl: string }> {
  const created = await page.evaluate(async (draftTitle) => {
    const response = await fetch('https://zhuanlan.zhihu.com/api/articles/drafts', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: draftTitle,
        delta_time: 0,
        can_reward: false
      })
    });

    if (!response.ok) {
      throw new Error(`Zhihu draft create failed with ${response.status}`);
    }

    return response.json() as Promise<{ id?: string }>;
  }, title);

  const draftId = created.id;
  if (!draftId) {
    throw new Error(`Zhihu draft create returned no id: ${JSON.stringify(created)}`);
  }

  await page.evaluate(async ({ id, content }) => {
    const response = await fetch(`https://zhuanlan.zhihu.com/api/articles/${id}/draft`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content,
        table_of_contents: false,
        delta_time: 1,
        can_reward: false
      })
    });

    if (!response.ok) {
      throw new Error(`Zhihu draft patch failed with ${response.status}`);
    }
  }, { id: draftId, content: html });

  return {
    draftId,
    draftUrl: `https://zhuanlan.zhihu.com/p/${draftId}/edit`
  };
}

function splitMarkdownIntoBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const imagePattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  let lastIndex = 0;

  for (const match of markdown.matchAll(imagePattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const text = markdown.slice(lastIndex, start);
    if (text) {
      blocks.push({ type: 'text', value: text });
    }

    const originalUrl = match[1]?.trim();
    if (originalUrl) {
      blocks.push({ type: 'image', originalUrl });
    }
    lastIndex = end;
  }

  const trailing = markdown.slice(lastIndex);
  if (trailing) {
    blocks.push({ type: 'text', value: trailing });
  }

  return blocks;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function logZhihu(message: string): void {
  console.log(`[DraftFlow][Zhihu] ${message}`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function waitForEditorReady(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    if (page.url().includes('/signin')) {
      logZhihu(`editor readiness: still on signin page ${page.url()}`);
      await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
      continue;
    }

    const authenticated = await isAuthenticated(page);
    const hasEditorDom = await hasArticleEditorDom(page);
    if (authenticated && hasEditorDom) {
      logZhihu(`editor readiness confirmed after ${attempts} checks`);
      return true;
    }

    if (attempts === 1 || attempts % 5 === 0) {
      logZhihu(`editor readiness pending... attempt ${attempts}; url=${page.url()}; editorDom=${hasEditorDom}`);
    }
    await page.waitForTimeout(800);
  }

  return false;
}

async function hasArticleEditorDom(page: Page): Promise<boolean> {
  return page.evaluate((selector) => {
    const hasTitle = Boolean(
      document.querySelector('textarea[placeholder="请输入标题（最多 100 个字）"]')
      || document.querySelector('textarea[placeholder="标题"]')
      || document.querySelector('input[placeholder*="标题"]')
      || document.querySelector('textarea[placeholder*="标题"]')
    );
    const hasBody = Boolean(document.querySelector(selector));

    return hasTitle && hasBody;
  }, ZHIHU_MAIN_EDITOR_SELECTOR);
}

async function collectEditorDiagnostics(page: Page): Promise<string> {
  const info = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, textarea'))
      .slice(0, 12)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        placeholder: node.getAttribute('placeholder') ?? '',
        ariaLabel: node.getAttribute('aria-label') ?? ''
      }));

    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .slice(0, 12)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        className: node.getAttribute('class') ?? '',
        placeholder: node.getAttribute('placeholder') ?? '',
        dataPlaceholder: node.getAttribute('data-placeholder') ?? '',
        ariaLabel: node.getAttribute('aria-label') ?? '',
        textPreview: (node.textContent ?? '').trim().slice(0, 80)
      }));

    return {
      url: location.href,
      title: document.title,
      inputs,
      editables
    };
  });

  return `diagnostics=${JSON.stringify(info)}`;
}

async function waitForAuthenticationReady(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    const authenticated = await isAuthenticated(page);
    if (authenticated) {
      logZhihu(`authentication readiness confirmed after ${attempts} checks`);
      return true;
    }

    if (attempts === 1 || attempts % 5 === 0) {
      logZhihu(`authentication readiness pending... attempt ${attempts}; url=${page.url()}`);
    }

    await page.waitForTimeout(800);
  }

  return false;
}
