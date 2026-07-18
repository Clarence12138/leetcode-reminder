import { createRoot } from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { ContentNotice } from '../src/leetcode/ContentNotice';
import { LeetCodeCnClient } from '../src/leetcode/api-client';
import { readCookieValue } from '../src/leetcode/cookies';
import { ContentController } from '../src/leetcode/content-controller';
import { SubmissionDetector, type DetectorRoute } from '../src/leetcode/detector';
import { extractProblemSlug, extractSubmissionRoute } from '../src/leetcode/url';
import { isSubmitShortcut } from '../src/leetcode/shortcut';
import '../src/leetcode/content.css';

const SUBMIT_SELECTOR = '[data-e2e-locator="console-submit-button"]';

export default defineContentScript({
  matches: ['https://leetcode.cn/problems/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    const controller = new ContentController();
    const detector = createDetector(controller);
    controller.setRetryHandler(() => detector.retryLast());

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
