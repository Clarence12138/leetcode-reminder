# 商店视觉素材

本目录的视觉素材为小刷记原创设计，不使用力扣 Logo、截图或第三方图片。

生成环境需要 macOS Quick Look（`qlmanage`）和 ImageMagick 7。Quick Look 负责准确渲染系统中文字体，ImageMagick 负责图标缩放、裁切和元数据清理：

```bash
./scripts/generate-store-assets.sh
node scripts/validate-package.mjs
```

可编辑的图标和宣传图源稿位于 `store-assets/source/`。脚本会生成：

- `public/icons/`：16、32、48、128 px 扩展图标；
- `promo-440x280.png`：Chrome Web Store 小型宣传图；
- `screenshots/`：4 张从最终扩展真实界面采集的 1280×800 中文截图，脚本不会生成或覆盖它们。

仓库不保留合成截图源稿。功能或布局发生变化后，必须重新从最终构建采集截图。
