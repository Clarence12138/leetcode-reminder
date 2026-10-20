import { LeetCodeCnClient } from '../src/leetcode/api-client';
import { readCookieValue } from '../src/leetcode/cookies';
import { LeetCodeHistoryClient } from '../src/leetcode/history-client';
import { serveHistoryPort } from '../src/leetcode/history-port-server';

// 力扣接口要求同源请求和页面 CSRF，因此读取做题记录必须在力扣页面内进行。
export default defineContentScript({
  matches: ['https://leetcode.cn/*'],
  runAt: 'document_idle',
  main() {
    const client = new LeetCodeHistoryClient(new LeetCodeCnClient({
      csrfTokenProvider: () => readCookieValue(document.cookie, 'csrftoken'),
    }));
    chrome.runtime.onConnect.addListener((port) => serveHistoryPort(port, client));
  },
});
