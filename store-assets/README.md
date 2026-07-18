# 商店视觉素材

本目录的视觉素材为小刷记原创设计，不使用力扣 Logo、截图或第三方图片。

生成环境需要 macOS Quick Look（`qlmanage`）和 ImageMagick 7。Quick Look 负责准确渲染系统中文字体，ImageMagick 负责图标缩放、裁切和元数据清理：

```bash
./scripts/generate-store-assets.sh
node scripts/validate-package.mjs
```

可编辑源稿位于 `store-assets/source/`。脚本会生成：

- `public/icons/`：16、32、48、128 px 扩展图标；
- `promo-440x280.png`：Chrome Web Store 小型宣传图；
- `screenshots/`：4 张 1280×800 中文产品界面图。

商店提交前应把界面图与最终构建逐项比对；如果功能或布局发生变化，必须同步更新源稿，避免商店信息与实际产品不一致。
