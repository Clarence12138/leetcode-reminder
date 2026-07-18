# Chrome Web Store 上架清单

## 1. 发布前验证

- [ ] 使用 Node 20 与锁定的 pnpm 版本安装依赖。
- [ ] `pnpm lint` 通过。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 在 60 秒硬超时内通过。
- [ ] `pnpm build` 与 `pnpm zip` 通过。
- [ ] `node scripts/validate-package.mjs` 通过。
- [ ] 在干净 Chrome Profile 中加载 `.output/chrome-mv3/`。
- [ ] 按 README 的“真实账号验收”逐项检查。
- [ ] 检查弹窗、完整面板、页内评分框在 100% 与 125% 缩放下可用。

## 2. 隐私政策

- [ ] 将仓库推送到公开 GitHub 仓库。
- [ ] 在仓库 Settings → Pages 中选择从分支发布 `docs/`。
- [ ] 打开生成的 HTTPS `privacy.html`，确认无需登录即可访问。
- [ ] 将该地址填写到 Chrome Web Store 隐私政策字段。
- [ ] 在商店隐私实践中声明：数据不出售、不用于广告、不传往开发者服务器、不使用远程代码。
- [ ] 逐项核对权限说明，确保与最终 ZIP 中 Manifest 一致。

## 3. 商店资料

- [ ] 名称、简短说明和详细说明复制自 `docs/store-listing.md`。
- [ ] 上传 128×128 图标。
- [ ] 上传 440×280 小型宣传图。
- [ ] 按顺序上传 4 张 1280×800 中文截图。
- [ ] 分类选择“生产力工具”，语言选择“简体中文”。
- [ ] 支持与开发者联系方式使用可长期维护的真实地址。
- [ ] 明确声明只支持力扣中文站普通题目页，避免夸大能力。

## 4. ZIP 与合规

- [ ] 上传 `.output/` 下由 `pnpm zip` 产生且已校验的 Chrome ZIP。
- [ ] ZIP 根目录包含 `manifest.json`，Manifest 版本为 3。
- [ ] 权限仅为 `storage`、`alarms`、`notifications`。
- [ ] 主机权限仅为 `https://leetcode.cn/*`。
- [ ] 不包含 `tabs`、`cookies`、`downloads`、`webRequest`、`unlimitedStorage`。
- [ ] 不包含远程脚本、动态下载代码、模拟 Accepted 或测试后门。
- [ ] 版本号高于上一次商店版本。

## 5. 提交后

- [ ] 保存提交版本、Git commit、ZIP SHA-256 与提交日期。
- [ ] 记录审核反馈，不通过放宽权限或隐藏失败来规避问题。
- [ ] 发布后从商店安装一次，复测 Accepted、评分、提醒、导入导出。
- [ ] 后续站内接口变动时明确显示检测异常，并更新适配器与测试。

> 实际上传与发布必须由 Chrome Web Store 开发者账号持有人完成。本仓库的构建和 CI 不会自动上传商店。
