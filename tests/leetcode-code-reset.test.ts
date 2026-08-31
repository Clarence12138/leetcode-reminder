import { afterEach, describe, expect, it } from 'vitest';
import { resetEditorToDefaultTemplate } from '../src/leetcode/code-reset';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resetEditorToDefaultTemplate', () => {
  it('点击圆形还原图标，并在操作确认弹层中点确认', async () => {
    const clicks: string[] = [];
    document.body.append(iconResetButton(() => {
      clicks.push('reset');
      document.body.append(resetConfirmDialog({ clicks }));
    }));

    await expect(resetEditorToDefaultTemplate(fastOptions())).resolves.toBe(true);
    expect(clicks).toEqual(['reset', '确认']);
  });

  it('识别力扣实际文案「模版」', async () => {
    const reset = document.createElement('button');
    reset.setAttribute('aria-label', '还原到默认的代码模版');
    reset.addEventListener('click', () => {
      document.body.append(resetConfirmDialog({}));
    });
    document.body.append(reset);

    await expect(resetEditorToDefaultTemplate(fastOptions())).resolves.toBe(true);
  });

  it('找不到还原按钮时静默失败', async () => {
    document.body.innerHTML = '<button type="button">提交</button>';
    await expect(resetEditorToDefaultTemplate(fastOptions({ timeoutMs: 20 }))).resolves.toBe(false);
  });

  it('没有确认弹层时仍视为已尝试还原', async () => {
    document.body.append(iconResetButton());
    await expect(resetEditorToDefaultTemplate(fastOptions({ confirmTimeoutMs: 20 }))).resolves.toBe(true);
  });

  it('不会把「还原到最新提交」当成默认模板还原', async () => {
    const clicks: string[] = [];
    const retrieve = document.createElement('button');
    retrieve.setAttribute('aria-label', '还原到最新提交的代码');
    retrieve.addEventListener('click', () => clicks.push('retrieve'));
    document.body.append(retrieve);
    document.body.append(iconResetButton(() => clicks.push('reset')));

    await expect(resetEditorToDefaultTemplate(fastOptions({ confirmTimeoutMs: 20 }))).resolves.toBe(true);
    expect(clicks).toEqual(['reset']);
  });

  it('不会确认「还原到最新提交」的弹层', async () => {
    const clicks: string[] = [];
    document.body.append(iconResetButton(() => {
      const dialog = document.createElement('div');
      dialog.innerHTML = '<div>你确定要使用最近一次提交的代码来替换现有代码吗？</div><button type="button">取消</button><button type="button">确认</button>';
      dialog.addEventListener('click', (event) => {
        if (event.target instanceof HTMLButtonElement) clicks.push(event.target.textContent ?? '');
      });
      document.body.append(dialog);
    }));

    await expect(resetEditorToDefaultTemplate(fastOptions({ confirmTimeoutMs: 20 }))).resolves.toBe(true);
    expect(clicks).toEqual([]);
  });

  it('确认还原后等到编辑器内容变成模板', async () => {
    const viewLines = monacoViewLines('old solution');
    document.body.append(viewLines.editor);
    document.body.append(iconResetButton(() => {
      document.body.append(resetConfirmDialog({
        onConfirm: () => {
          viewLines.viewLines.textContent = 'class Solution {}';
        },
      }));
    }));

    await expect(resetEditorToDefaultTemplate(fastOptions({ applyTimeoutMs: 200 }))).resolves.toBe(true);
    expect(viewLines.viewLines.textContent).toBe('class Solution {}');
  });
});

function iconResetButton(onClick?: () => void): HTMLButtonElement {
  const reset = document.createElement('button');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('data-icon', 'arrow-rotate-left');
  reset.append(icon);
  if (onClick) reset.addEventListener('click', onClick);
  return reset;
}

function resetConfirmDialog(options: {
  readonly clicks?: string[];
  readonly onConfirm?: () => void;
} = {}): HTMLDivElement {
  const dialog = document.createElement('div');
  dialog.innerHTML = '<h3>操作确认</h3><div>您将放弃所有更改并初始化代码！</div><button type="button">取消</button><button type="button">确认</button>';
  dialog.addEventListener('click', (event) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    options.clicks?.push(event.target.textContent ?? '');
    if (event.target.textContent === '确认') options.onConfirm?.();
  });
  return dialog;
}

function monacoViewLines(text: string): { readonly editor: HTMLDivElement; readonly viewLines: HTMLDivElement } {
  const editor = document.createElement('div');
  editor.className = 'monaco-editor';
  const viewLines = document.createElement('div');
  viewLines.className = 'view-lines';
  viewLines.textContent = text;
  editor.append(viewLines);
  return { editor, viewLines };
}

function fastOptions(overrides: {
  readonly timeoutMs?: number;
  readonly confirmTimeoutMs?: number;
  readonly applyTimeoutMs?: number;
} = {}) {
  let now = 0;
  return {
    settleMs: 0,
    editorTimeoutMs: 0,
    applySettleMs: 0,
    applyTimeoutMs: overrides.applyTimeoutMs ?? 0,
    intervalMs: 5,
    timeoutMs: overrides.timeoutMs ?? 200,
    confirmTimeoutMs: overrides.confirmTimeoutMs ?? 200,
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        now += Math.max(ms, 5);
      },
    },
  };
}
