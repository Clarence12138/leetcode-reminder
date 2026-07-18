# 小刷记 · 力扣复习助手

小刷记是一款面向 [力扣中文站](https://leetcode.cn/) 的 Chrome 扩展。它会在结构化判题结果明确为 Accepted 后保存一次本地记录，让你选择掌握程度，并使用 FSRS-6 安排后续复习。

> 当前版本只支持已登录用户的 `leetcode.cn/problems/*` 普通题目页。扩展不会保存提交代码、Cookie、账号凭据，也不包含遥测或远程代码。

## 功能

- 识别点击“提交”、macOS `Command + Enter`、Windows/Linux `Ctrl + Enter`。
- 仅当判题接口返回 `state === "SUCCESS"` 且 `status_code === 10` 时记录。
- Accepted 后选择“未掌握 / 吃力 / 掌握 / 熟练”，分别对应 FSRS 的 Again / Hard / Good / Easy。
- 关闭评分框后保留“待评估”记录，不会擅自生成复习计划。
- 使用 FSRS-6、0.90 目标保持率安排复习；默认每天当地时间 09:00 汇总提醒。
- 提供今日队列、题目筛选、复习历史、检测异常、数据导入导出等中文界面。
- 所有长期数据保存在本机 IndexedDB / `chrome.storage.local`。

## 本地开发

环境要求：Node.js 20.12 或更高版本、pnpm 9.15.9、Chrome。

```bash
corepack enable
pnpm install
pnpm dev
```

构建、检查和打包：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm zip
node scripts/validate-package.mjs
```

`pnpm build` 生成 `.output/chrome-mv3/`，`pnpm zip` 在 `.output/` 下生成可提交 Chrome Web Store 的 ZIP。校验脚本会检查 Manifest V3、权限、主机范围、禁止项、ZIP 内图标，以及商店 PNG 素材尺寸。

`pnpm test:integration` 使用测试目录内启动的本地 HTTP 端点，串联提交详情路由、结构化判题、中文 GraphQL、待评估记录和 FSRS 排期。模拟端点只存在于 Vitest 测试构建，不会进入生产扩展包。

### 在 Chrome 中加载

1. 执行 `pnpm build`。
2. 打开 `chrome://extensions`，启用“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择 `.output/chrome-mv3/`。
4. 登录力扣中文站，进入普通题目页进行真实账号验收。

## 使用方式

1. 在力扣中文站提交题目，等待 Accepted。
2. 在页内面板选择本次掌握程度；如果暂时关闭，可稍后在扩展弹窗或完整面板补评。
3. 点击扩展图标查看今日到期、逾期和待评估数量。
4. 每日提醒或角标出现后，进入完整面板按队列复习。

评分不是“答对/答错”的重复记录，而是对本次回忆难度的反馈：

| 选择 | FSRS 评分 | 建议场景 |
| --- | --- | --- |
| 未掌握 | Again | 几乎无法独立完成，需要重新学习 |
| 吃力 | Hard | 最终完成，但回忆困难或依赖提示 |
| 掌握 | Good | 能独立完成，过程基本顺畅 |
| 熟练 | Easy | 思路和实现都非常熟练 |

## 数据与权限

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存设置、提醒状态和本地复习数据 |
| `alarms` | 安排每天一次的本地提醒检查 |
| `notifications` | 展示到期题目与待评估汇总 |
| `https://leetcode.cn/*` | 在题目页读取当前题目元数据与判题结果 |

扩展不申请 `tabs`、`cookies`、`downloads`、`webRequest` 或 `unlimitedStorage`。完整说明见[隐私政策](docs/privacy.html)。
读取中文题目信息时，扩展会临时读取当前页面可见的 `csrftoken`，仅用于 GraphQL 的同源 `X-CSRFToken` 请求头；不会写入存储、备份或日志，也不会发送给开发者或第三方。

### 备份与恢复

- 导出格式为 `xiaoshuaji-backup/v1` JSON。
- “合并导入”会跳过内容一致的相同提交；发现冲突会中止整次导入。
- “覆盖恢复”会替换现有数据，必须在界面中二次确认。
- 导入前会完整校验；排期会根据评分历史重建，不信任备份中的缓存排期。

## 真实账号验收

- “运行”、Wrong Answer、超时等结果均不产生 Accepted 记录。
- 点击提交和 `Command/Ctrl + Enter` 的 Accepted 均出现四档评分。
- 相同提交 ID 不重复；再次 Accepted 生成新的复习事件。
- 关闭评分框后记录进入“待评估”，且不会产生到期时间。
- 退出登录后出现明确登录提示；接口异常进入“检测异常”。
- 点击系统通知后打开正确的待复习队列。

更完整的发布前步骤见[上架清单](docs/publishing-checklist.md)，商店文案见[商店详情](docs/store-listing.md)。

## 项目边界

首版不支持 `leetcode.com`、竞赛页、历史提交回填、云同步、笔记、移动端或其他浏览器。力扣站内接口可能调整；本项目会明确报告检测异常，不通过页面文案猜测 Accepted。

“LeetCode”和“力扣”是其各自权利人的商标。本项目与力扣官方无隶属或背书关系。

## 致谢与许可

排期使用 MIT 许可的 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)。交互与实现调研参考了 LeetCode EasyRepeat、LeetSRS、AlgoRecall 和 LeetRecur 的公开信息；本项目代码与视觉资产均为独立实现，不复制无许可证项目代码。

本项目使用 [MIT License](LICENSE)。
随扩展分发的第三方许可证见 `public/THIRD_PARTY_NOTICES.txt` 与 `public/licenses/`。
