import { createRoot } from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { ContentNotice } from '../src/leetcode/ContentNotice';
import { LeetCodeCnClient } from '../src/leetcode/api-client';
import { readCookieValue } from '../src/leetcode/cookies';
import { ContentController } from '../src/leetcode/content-controller';
import { SubmissionDetector, type DetectorRoute } from '../src/leetcode/detector';
import { resetEditorToDefaultTemplate } from '../src/leetcode/code-reset';
import { coverEditorCode } from '../src/leetcode/editor-cover';
import {
  captureReviewResetIntent,
  clearReviewResetIntent,
  extractProblemSlug,
  extractSubmissionRoute,
  hasReviewResetIntent,
} from '../src/leetcode/url';
import { isSubmitShortcut } from '../src/leetcode/shortcut';
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
    startReviewCodeReset(controller, window.location.href);

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

    ctx.addEventListener(document, 'click', (event) => handleSubmitClick(event, detector), true);
    ctx.addEventListener(window, 'keydown', (event) => handleSubmitShortcut(event, detector), true);
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => {
      detector.updateRoute(toDetectorRoute(newUrl));
      startReviewCodeReset(controller, newUrl.href);
    });
    detector.updateRoute(toDetectorRoute(window.location));
  },
});

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

let codeResetStarted = false;

function startReviewCodeReset(controller: ContentController, href: string): void {
  captureReviewResetIntent(href, sessionStorage, history);
  const slug = extractProblemSlug(new URL(href, 'https://leetcode.cn'));
  if (!slug || !hasReviewResetIntent(slug, sessionStorage) || codeResetStarted) return;
  codeResetStarted = true;
  const uncover = coverEditorCode();
  void performCodeReset(controller, slug).finally(uncover);
}

async function performCodeReset(controller: ContentController, slug: string): Promise<void> {
  controller.showHint('正在还原默认代码模板…');
  const ok = await resetEditorToDefaultTemplate();
  clearReviewResetIntent(slug, sessionStorage);
  controller.showHint(ok ? '已还原为默认代码模板' : '未能自动还原，请手动点击编辑器右上角圆形还原按钮');
  window.setTimeout(() => controller.dismissHint(), HINT_DISMISS_MS);
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
