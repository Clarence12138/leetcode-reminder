# Chrome Web Store 自动发布清单

## 1. 一次性授权配置

- [ ] 在 Google Cloud 项目中启用 Chrome Web Store API 与 IAM Service Account Credentials API。
- [ ] 创建专用 service account，不创建或下载 JSON 私钥。
- [ ] 配置 GitHub OIDC Workload Identity Federation，信任条件同时限定本仓库的 repository ID 与 owner ID。
- [ ] 只向该仓库对应的 federated principal 授予 service account 的 `roles/iam.workloadIdentityUser`。
- [ ] 在 Chrome Web Store 发布者设置中添加该 service account；若已有其他 service account，先停止并核对，不自动替换。
- [ ] 在 GitHub Actions Variables 配置 `GCP_PROJECT_ID`、`GCP_WORKLOAD_IDENTITY_PROVIDER`、`GCP_SERVICE_ACCOUNT`、`CHROME_WEB_STORE_PUBLISHER_ID`、`CHROME_EXTENSION_ID` 与 `CHROME_UPLOAD_TIMEOUT_MS`。
- [ ] 手动运行 **Publish Chrome Web Store** 工作流的 `status` 模式，确认能读取正确扩展、商店版本和发布状态。

`status` 是只读检查：它只调用状态查询，不构建、上传或提交扩展。工作流通过 OIDC 获取短期 access token，仓库不保存 OAuth client secret、refresh token、service account 私钥或 access token。

## 2. 每次发布

- [ ] 将 `package.json` 的版本提升到高于 Chrome Web Store 当前版本的 `X.Y.Z`；已发布版本不能重复上传。
- [ ] 完成功能与真实账号验收，将发布代码合入 `main`。
- [ ] 创建并推送与包版本严格匹配的标签 `vX.Y.Z`，例如包版本 `0.1.6` 必须使用 `v0.1.6`。
- [ ] 等待 **Publish Chrome Web Store** 工作流完成全部检查、构建、精确 ZIP 校验、上传与送审。
- [ ] 从工作流 summary 和保留 14 天的 artifact 核对版本、Git commit、ZIP 路径与 SHA-256。

建议 pi 使用以下固定流程：提升 `package.json` 版本，完成检查并合入 `main`，然后推送匹配的 `vX.Y.Z` 标签。标签推送会自动上传并送审；审核通过后沿用商店现有发布范围公开。工作流不会上传商店截图、宣传图或修改商店资料。

需要重跑某个版本时，可手动选择 `publish` 并填写已经存在的 `vX.Y.Z` 标签。工作流会检出 `refs/tags/<tag>`，不允许从任意分支发布。标签必须与 `package.json` 版本完全一致。

## 3. 自动发布前验证

- [ ] 使用 Node 20.19 或更高版本与锁定的 pnpm 版本安装依赖。
- [ ] `pnpm lint` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 在 60 秒硬超时内通过。
- [ ] `pnpm test:integration` 在 60 秒硬超时内通过。
- [ ] `pnpm build` 与 `pnpm zip` 通过。
- [ ] `node scripts/validate-package.mjs <精确 ZIP 路径>` 通过。
- [ ] 在干净 Chrome Profile 中加载 `.output/chrome-mv3/`。
- [ ] 按 README 的“真实账号验收”逐项检查。
- [ ] 检查弹窗、完整面板、页内评分框在 100% 与 125% 缩放下可用。

## 4. 隐私政策

- [ ] 将仓库推送到公开 GitHub 仓库。
- [ ] 在仓库 Settings → Pages 中选择从分支发布 `docs/`。
- [ ] 打开生成的 HTTPS `privacy.html`，确认无需登录即可访问。
- [ ] 将该地址填写到 Chrome Web Store 隐私政策字段。
- [ ] 在商店隐私实践中声明：数据不出售、不用于广告、不传往开发者服务器、不使用远程代码，并完成 Limited Use 认证。
- [ ] 数据类型勾选“认证信息”、“网站内容”、“网络历史”和“用户活动”，并确认与隐私政策一致。
- [ ] 逐项核对权限说明，确保与最终 ZIP 中 Manifest 一致。

## 5. 商店资料

- [ ] 名称、简短说明和详细说明复制自 `docs/store-listing.md`。
- [ ] 上传 128×128 图标。
- [ ] 上传 440×280 小型宣传图。
- [ ] 按顺序上传 4 张 1280×800 中文截图。
- [ ] 截图来自最终扩展的真实界面，不包含账号、代码、Cookie 或其他个人信息。
- [ ] 分类选择“生产力工具”，语言选择“简体中文”。
- [ ] 支持与开发者联系方式使用可长期维护的真实地址。
- [ ] 明确声明只支持力扣中文站普通题目页，避免夸大能力。

## 6. ZIP 与合规

- [ ] 工作流上传 `.output/xiaoshuaji-leetcode-review-<version>-chrome.zip`，且校验与上传使用同一个精确路径。
- [ ] ZIP 根目录包含 `manifest.json`，Manifest 版本为 3。
- [ ] 权限仅为 `storage`、`alarms`、`notifications`。
- [ ] 主机权限仅为 `https://leetcode.cn/*`。
- [ ] 不包含 `tabs`、`cookies`、`downloads`、`webRequest`、`unlimitedStorage`。
- [ ] 不包含远程脚本、动态下载代码、模拟 Accepted 或测试后门。
- [ ] 版本号高于上一次商店版本。

## 7. 提交与审核

- [ ] 确认上传状态成功且送审请求成功。
- [ ] 确认 API 未返回 warning；工作流设置 `blockOnWarnings=true`，任何 warning 都会阻止送审并明确失败。
- [ ] 保存工作流记录中的提交版本、Git commit、ZIP SHA-256 与提交日期。
- [ ] 记录审核反馈，不通过放宽权限或隐藏失败来规避问题。
- [ ] 发布后从商店安装一次，复测 Accepted、评分、提醒、导入导出。
- [ ] 后续站内接口变动时明确显示检测异常，并更新适配器与测试。

自动发布只覆盖扩展 ZIP 上传与送审。首次授权、发布者账号设置、审核反馈处理以及商店资料变更仍由开发者账号持有人负责。
