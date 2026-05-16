import './styles.css';
import type { Platform, SyncResult, TaskHistoryEntry } from '../core/types';

declare global {
  interface Window {
    draftflow: {
      pickMarkdownFile(): Promise<string | null>;
      syncToPlatform(payload: { sourcePath: string; manualTitle?: string; platform: Platform }): Promise<SyncResult>;
      listTaskHistory(): Promise<TaskHistoryEntry[]>;
      retryTask(payload: { taskId: string }): Promise<SyncResult>;
    };
  }
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('renderer root not found');
}

root.innerHTML = `
  <main class="app-shell">
    <section class="hero">
      <p class="eyebrow">DraftFlow v1</p>
      <h1>Markdown -> 平台草稿</h1>
      <p class="subtitle">先跑通单篇 Markdown 到掘金 / 知乎草稿箱的最小闭环，图片失败时优先保住文本草稿。</p>
    </section>

    <section class="panel">
      <label class="field">
        <span>Markdown 文件</span>
        <div class="row">
          <input id="filePath" readonly placeholder="选择一个 .md 文件" />
          <button id="pickFile" type="button">选择文件</button>
        </div>
      </label>

      <label class="field">
        <span>手动标题</span>
        <input id="manualTitle" placeholder="可选，优先级高于 H1" />
      </label>

      <label class="field">
        <span>目标平台</span>
        <select id="platformSelect">
          <option value="juejin">掘金</option>
          <option value="zhihu">知乎</option>
        </select>
      </label>

      <button id="syncButton" class="primary" type="button" disabled>开始同步</button>
    </section>

    <section class="panel">
      <h2>结果</h2>
      <pre id="resultView">{\n  "status": "idle"\n}</pre>
    </section>

    <section class="panel">
      <h2>最近任务</h2>
      <div id="historyView" class="history-view empty">暂无任务记录</div>
    </section>
  </main>
`;

const filePathInput = document.getElementById('filePath') as HTMLInputElement;
const titleInput = document.getElementById('manualTitle') as HTMLInputElement;
const platformSelect = document.getElementById('platformSelect') as HTMLSelectElement;
const pickFileButton = document.getElementById('pickFile') as HTMLButtonElement;
const syncButton = document.getElementById('syncButton') as HTMLButtonElement;
const resultView = document.getElementById('resultView') as HTMLPreElement;
const historyView = document.getElementById('historyView') as HTMLDivElement;

function setResult(result: unknown): void {
  resultView.textContent = JSON.stringify(result, null, 2);
}

function refreshSyncState(): void {
  syncButton.disabled = !filePathInput.value;
}

function renderHistory(history: TaskHistoryEntry[]): void {
  if (history.length === 0) {
    historyView.className = 'history-view empty';
    historyView.textContent = '暂无任务记录';
    return;
  }

  historyView.className = 'history-view';
  historyView.innerHTML = history
    .slice(0, 8)
    .map((entry) => {
      const retryButton =
        entry.status === 'failure' || entry.status === 'partial_success'
          ? `<button class="retry-button" data-task-id="${entry.taskId}" type="button">重试</button>`
          : '';
      return `
        <article class="history-card">
          <div class="history-meta">
            <strong>${entry.platform}</strong>
            <span>${entry.status}</span>
          </div>
          <div class="history-title">${escapeHtml(entry.title || '(无标题)')}</div>
          <div class="history-path">${escapeHtml(entry.sourceFile)}</div>
          <div class="history-summary">图片成功 ${entry.uploadedImageCount} 张，失败 ${entry.failedImages.length} 张</div>
          <div class="history-actions">
            ${retryButton}
          </div>
        </article>
      `;
    })
    .join('');
}

async function refreshHistory(): Promise<void> {
  const history = await window.draftflow.listTaskHistory();
  renderHistory(history);
}

if (!window.draftflow) {
  setResult({
    status: 'failure',
    errorMessage: 'preload bridge missing: window.draftflow is undefined'
  });
  pickFileButton.disabled = true;
  syncButton.disabled = true;
  throw new Error('preload bridge missing');
}

pickFileButton.addEventListener('click', async () => {
  const picked = await window.draftflow.pickMarkdownFile();
  if (!picked) {
    return;
  }

  filePathInput.value = picked;
  refreshSyncState();
  setResult({ status: 'ready', sourceFile: picked });
});

syncButton.addEventListener('click', async () => {
  if (!filePathInput.value) {
    return;
  }

  syncButton.disabled = true;
  syncButton.textContent = '同步中...';

  try {
    const result = await window.draftflow.syncToPlatform({
      sourcePath: filePathInput.value,
      manualTitle: titleInput.value,
      platform: platformSelect.value as Platform
    });
    setResult(result);
    await refreshHistory();
  } catch (error) {
    setResult({
      status: 'failure',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  } finally {
    syncButton.textContent = '开始同步';
    refreshSyncState();
  }
});

historyView.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement;
  const taskId = target.getAttribute('data-task-id');
  if (!taskId) {
    return;
  }

  syncButton.disabled = true;
  syncButton.textContent = '重试中...';
  try {
    const result = await window.draftflow.retryTask({ taskId });
    setResult(result);
    await refreshHistory();
  } catch (error) {
    setResult({
      status: 'failure',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  } finally {
    syncButton.textContent = '开始同步';
    refreshSyncState();
  }
});

void refreshHistory();

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
