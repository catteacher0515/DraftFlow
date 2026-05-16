import fs from 'node:fs/promises';

import { chromium, type BrowserContext, type Page } from 'playwright';

import { createSessionStore } from '../session-store';
import { uploadLocalImageToJuejin } from './juejin-image-upload';

export interface JuejinAdapter {
  ensureAuthenticated(): Promise<void>;
  uploadLocalImage(absolutePath: string): Promise<string>;
  createDraft(payload: {
    title: string;
    mark_content: string;
    localImageMap?: Record<string, string>;
  }): Promise<{ draftId: string; draftUrl: string }>;
  close(): Promise<void>;
}

const JUEJIN_EDITOR_URL = 'https://juejin.cn/editor/drafts/new?v=2';
const JUEJIN_LOGIN_URL = 'https://juejin.cn/login';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_POLL_INTERVAL_MS = 1_000;

export async function createJuejinAdapter(rootDir: string): Promise<JuejinAdapter> {
  const sessionStore = createSessionStore(rootDir);
  await sessionStore.ensureDirectories();

  const context = await launchBrowserContext(rootDir + '/sessions/juejin/user-data');
  let page = await ensurePage(context);

  return {
    async ensureAuthenticated() {
      logJuejin('checking authentication');
      await page.goto(JUEJIN_EDITOR_URL, { waitUntil: 'domcontentloaded' });
      let authenticated = await isAuthenticated(context);

      if (!authenticated) {
        logJuejin('login required, opening login page');
        await page.goto(JUEJIN_LOGIN_URL, { waitUntil: 'domcontentloaded' });
        await page.bringToFront();

        const loggedIn = await waitForAuthentication(context, LOGIN_TIMEOUT_MS);
        if (!loggedIn) {
          throw new Error('Juejin login timed out after 5 minutes. Please complete login faster and retry.');
        }

        logJuejin('login detected, reopening editor');
        page = await ensureUsablePage(context);
        await page.goto(JUEJIN_EDITOR_URL, { waitUntil: 'domcontentloaded' });
        authenticated = await isAuthenticated(context);
      }

      if (!authenticated) {
        throw new Error('Juejin authentication probe still failed after login redirect.');
      }

      await context.storageState({ path: sessionStore.getStorageStatePath() });
      logJuejin('authentication ready');
    },
    async uploadLocalImage(absolutePath: string) {
      logJuejin(`uploading local image: ${absolutePath}`);
      return uploadLocalImageToJuejin(page, absolutePath);
    },
    async createDraft(payload: { title: string; mark_content: string }) {
      logJuejin(`creating draft via editor automation: ${payload.title}`);
      page = await ensureUsablePage(context);
      await openFreshEditor(page);
      await fillTitle(page, payload.title);
      await fillMarkdown(page, payload.mark_content);

      const draft = await waitForDraftSave(page);
      logJuejin(`draft created: ${draft.draftId}`);
      return draft;
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
      'DraftFlow could not start a Chromium-compatible browser for Juejin sync.',
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

async function isAuthenticated(context: BrowserContext): Promise<boolean> {
  const probe = await probeAuthentication(context);
  logJuejin(`auth probe: ${probe.reason}`);
  return probe.authenticated;
}

async function waitForAuthentication(context: BrowserContext, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    if (await isAuthenticated(context)) {
      logJuejin(`login confirmed after ${attempts} auth checks`);
      return true;
    }

    if (attempts === 1 || attempts % 10 === 0) {
      logJuejin(`waiting for login... attempt ${attempts}; pages=${formatPageUrls(context.pages())}`);
    }

    await context.pages()[0]?.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  }

  return false;
}

async function probeAuthentication(
  context: BrowserContext
): Promise<{ authenticated: boolean; reason: string }> {
  const pages = context.pages();
  const candidatePages = pages
    .filter((item) => isJuejinUrl(item.url()))
    .sort((left, right) => right.url().localeCompare(left.url()));

  for (const candidate of candidatePages) {
    const url = candidate.url();
    if (isAuthenticatedUrl(url)) {
      return {
        authenticated: true,
        reason: `authenticated by URL ${url}`
      };
    }
  }

  for (const candidate of candidatePages) {
    const url = candidate.url();
    try {
      const result = await candidate.evaluate(async () => {
        try {
          const response = await fetch('/user_api/v1/user/get_user_info', {
            method: 'GET',
            credentials: 'include'
          });

          if (!response.ok) {
            return { authenticated: false, reason: `fetch status ${response.status}` };
          }

          const data = (await response.json()) as { err_no?: number };
          return {
            authenticated: !data.err_no,
            reason: `fetch err_no ${data.err_no ?? 0}`
          };
        } catch (error) {
          return {
            authenticated: false,
            reason: error instanceof Error ? error.message : String(error)
          };
        }
      });

      if (result.authenticated) {
        return {
          authenticated: true,
          reason: `authenticated by in-page fetch on ${url}`
        };
      }
    } catch (error) {
      logJuejin(`auth fetch probe failed on ${url}: ${toErrorMessage(error)}`);
    }
  }

  const urls = formatPageUrls(pages);
  return {
    authenticated: false,
    reason: `no authenticated page detected; pages=${urls}`
  };
}

async function ensureUsablePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  for (const candidate of [...pages].reverse()) {
    if (!candidate.isClosed() && isJuejinUrl(candidate.url())) {
      return candidate;
    }
  }

  return ensurePage(context);
}

async function openFreshEditor(page: Page): Promise<void> {
  await page.goto(JUEJIN_EDITOR_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-input');
  await page.waitForSelector('.CodeMirror');
  await page.waitForTimeout(1000);
}

async function fillTitle(page: Page, title: string): Promise<void> {
  await page.fill('.title-input', title);
}

async function fillMarkdown(page: Page, markdown: string): Promise<void> {
  await page.evaluate((value) => {
    const codeMirrorHost = document.querySelector('.CodeMirror') as {
      CodeMirror?: { setValue: (content: string) => void };
    } | null;

    if (!codeMirrorHost?.CodeMirror) {
      throw new Error('CodeMirror editor not found');
    }

    codeMirrorHost.CodeMirror.setValue(value);
  }, markdown);
}

async function waitForDraftSave(page: Page): Promise<{ draftId: string; draftUrl: string }> {
  await page.waitForFunction(() => {
    const statusText = document.querySelector('.status-text')?.textContent ?? '';
    return statusText.includes('保存成功') && location.pathname.includes('/editor/drafts/');
  }, { timeout: 30_000 });

  const draftUrl = page.url();
  const draftId = draftUrl.match(/\/editor\/drafts\/(\d+)/)?.[1];

  if (!draftId) {
    throw new Error(`Juejin editor saved draft but no draft id was found in URL: ${draftUrl}`);
  }

  return {
    draftId,
    draftUrl
  };
}

function isAuthenticatedUrl(url: string): boolean {
  if (!isJuejinUrl(url)) {
    return false;
  }

  if (url.includes('/login')) {
    return false;
  }

  return url.includes('/creator/') || url.includes('/editor/');
}

function isJuejinUrl(url: string): boolean {
  return url.includes('juejin.cn');
}

function formatPageUrls(pages: Page[]): string {
  const urls = pages.map((item) => item.url()).filter(Boolean);
  return urls.length > 0 ? urls.join(' | ') : '(no pages)';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function logJuejin(message: string): void {
  console.log(`[DraftFlow][Juejin] ${message}`);
}
