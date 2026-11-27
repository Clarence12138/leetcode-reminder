import { createRoot } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { ContentNotice } from '../src/leetcode/ContentNotice';
import { LeetCodeCnClient } from '../src/leetcode/api-client';
import { readCookieValue } from '../src/leetcode/cookies';
import { ContentController } from '../src/leetcode/content-controller';
import { SubmissionDetector, type DetectorRoute } from '../src/leetcode/detector';
import {
  dismissResetConfirmDialog,
  resetEditorToDefaultTemplate,
} from '../src/leetcode/code-reset';
import { coverEditorCode } from '../src/leetcode/editor-cover';
import { getNavigationApi, watchCommittedLocation } from '../src/leetcode/location-watcher';
import {
  captureReviewResetIntent,
  clearReviewResetIntent,
  extractProblemSlug,
  extractSubmissionRoute,
  hasReviewResetIntent,
} from '../src/leetcode/url';
import { isSubmitShortcut } from '../src/leetcode/shortcut';
import { sendExtensionRequest } from '../src/shared/messaging';
import { setDisplayTimezone } from '../src/ui/format';
import '../src/ui/tokens.css';
import '../src/leetcode/content.css';

const SUBMIT_SELECTOR = '[data-e2e-locator="console-submit-button"]';
const HINT_DISMISS_MS = 2_800;

export default defineContentScript({
  matches: ['https://leetcode.cn/problems/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    captureReviewResetIntent(window.location.href, sessionStorage, history);
    const controller = new ContentController();
    const detector = createDetector(controller);
    controller.setRetryHandler(() => detector.retryLast());

    const initialUrl = new URL(window.location.href);
    let currentSlug = extractProblemSlug(initialUrl);
    const cancelReset = startPageLoadCodeReset(ctx, controller, currentSlug);

    ctx.addEventListener(document, 'click', (event) => handleSubmitClick(event, detector), { capture: true });
    ctx.addEventListener(window, 'keydown', (event) => handleSubmitShortcut(event, detector), { capture: true });
    watchCommittedLocation({
      signal: ctx.signal,
      getHref: () => window.location.href,
      navigation: getNavigationApi(),
      setInterval: (handler, ms) => ctx.setInterval(handler, ms),
    }, (newUrl) => {
      const nextSlug = extractProblemSlug(newUrl);
      if (nextSlug !== currentSlug) {
        currentSlug = nextSlug;
        cancelReset();
        controller.dismissError();
      }
      detector.updateRoute(toDetectorRoute(newUrl));
    });
    detector.updateRoute(toDetectorRoute(initialUrl));

    void syncDisplayTimezone();
    const ui = await createShadowRootUi(ctx, {
      name: 'xiaoshuaji-review-ui',
      position: 'overlay',
      alignment: 'bottom-right',
      anchor: 'body',
      zIndex: 2_147_483_647,
      isolateEvents: true,
      onMount(container) {
        const root = createRoot(container);
        root.render(<ContentNotice controller={controller} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.autoMount({ once: true });
  },
});

/** 评分卡里的“明天/9 天后/日期”按设置时区显示；读取失败时保持浏览器时区。 */
async function syncDisplayTimezone(): Promise<void> {
  try {
    const settings = await sendExtensionRequest({ type: 'settings.get' });
    setDisplayTimezone(settings.timezone);
  } catch {
    // 读不到设置不影响做题检测，按浏览器时区展示即可。
  }
}

function createDetector(controller: ContentController): SubmissionDetector {
  const client = new LeetCodeCnClient({
    csrfTokenProvider: () => readCookieValue(document.cookie, 'csrftoken'),
  });
  return new SubmissionDetector(client, {
    onAccepted: (submission) => controller.handleAccepted(submission),
    onMonitoringChange: (monitoring) => controller.setMonitoring(monitoring),
    onIssue: async (issue) => {
      await controller.recordIssue(issue.diagnostic, issue.retryable, {
        type: 'issue.record',
        payload: issue,
      });
    },
  });
}

function toDetectorRoute(location: Pick<Location, 'pathname'>): DetectorRoute {
  const submission = extractSubmissionRoute(location);
  return {
    slug: extractProblemSlug(location),
    submissionId: submission?.submissionId ?? null,
  };
}

interface CodeResetRun {
  readonly controller: ContentController;
  readonly slug: string;
  readonly signal: AbortSignal;
  readonly onDone: () => void;
  readonly scheduleHintDismiss: () => void;
}

function startPageLoadCodeReset(
  ctx: ContentScriptContext,
  controller: ContentController,
  slug: string | null,
): () => void {
  if (!slug || !hasReviewResetIntent(slug, sessionStorage)) return () => undefined;
  const resetAbort = new AbortController();
  const uncover = coverEditorCode();
  let resetActive = true;
  let hintTimer: number | null = null;

  const cancel = (): void => {
    const hadHintTimer = hintTimer !== null;
    if (hintTimer !== null) {
      window.clearTimeout(hintTimer);
      hintTimer = null;
    }
    if (!resetActive) {
      if (hadHintTimer) controller.dismissHint();
      return;
    }
    resetActive = false;
    resetAbort.abort();
    dismissResetConfirmDialog();
    uncover();
    clearReviewResetIntent(slug, sessionStorage);
    controller.dismissHint();
  };

  ctx.onInvalidated(cancel);
  void performCodeReset({
    controller,
    slug,
    signal: resetAbort.signal,
    onDone: () => {
      resetActive = false;
      uncover();
    },
    scheduleHintDismiss: () => {
      hintTimer = ctx.setTimeout(() => {
        hintTimer = null;
        controller.dismissHint();
      }, HINT_DISMISS_MS);
    },
  });
  return cancel;
}

async function performCodeReset(run: CodeResetRun): Promise<void> {
  const { controller, slug, signal, onDone, scheduleHintDismiss } = run;
  controller.showHint('正在还原默认代码模板…');
  try {
    const ok = await resetEditorToDefaultTemplate({ signal, expectedSlug: slug });
    if (signal.aborted) return;
    clearReviewResetIntent(slug, sessionStorage);
    onDone();
    controller.showHint(ok ? '已还原为默认代码模板' : '未能自动还原，请手动点击编辑器右上角圆形还原按钮');
    scheduleHintDismiss();
  } finally {
    if (!signal.aborted) onDone();
  }
}

function handleSubmitClick(event: Event, detector: SubmissionDetector): void {
  const target = event.target;
  if (target instanceof Element && target.closest(SUBMIT_SELECTOR)) {
    void detector.recordIntent('button');
  }
}

function handleSubmitShortcut(event: Event, detector: SubmissionDetector): void {
  if (!(event instanceof KeyboardEvent)) return;
  if (!isSubmitShortcut(event)) return;
  const submitButton = document.querySelector<HTMLButtonElement>(SUBMIT_SELECTOR);
  if (!submitButton || submitButton.disabled) return;
  void detector.recordIntent('keyboard');
}
