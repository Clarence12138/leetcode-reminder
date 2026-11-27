# 真实浏览器实测（Chrome for Testing）

扩展需要在真实浏览器里实测时，统一用本机的 Chrome for Testing（下称 CfT）和固定 profile。

- Paseo 内置浏览器是 Electron webview，没有 `chrome.runtime`，加载不了扩展。
- Chrome 正式版 137 起不再支持 `--load-extension`。

## 1. 本机环境

| 项 | 位置 |
|---|---|
| 浏览器 | `~/.cache/chrome-for-testing/156.0.8078.80/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` |
| 固定 profile | `~/.cache/xsj-e2e/profile` |
| CDP 驱动脚本 | `~/.cache/xsj-e2e/cdp.mjs`（需 nvm 的 Node 24） |
| 慢速导入脚本 | `~/.cache/xsj-e2e/slow-import.mjs` |
| 浏览器日志 | `~/.cache/xsj-e2e/chrome.log` |

这些文件都在本机，不在仓库里，也不要提交。

## 2. 力扣登录会话

固定 profile 里已经保存了测试账号的力扣登录会话，需要登录态的场景直接复用这个 profile，不要另开临时 profile。

- 账号密码不存档。密码登录会触发短信验证，会话过期时请用户在 CfT 窗口里手动登录。
- 同一个 profile 同时只能被一个浏览器实例使用。启动前先检查 9333 端口上是否已有实例，有就直接复用：

  ```sh
  curl -s -m 2 http://127.0.0.1:9333/json/version >/dev/null && echo "已在运行"
  ```

## 3. 启动（参数必须带全）

先 `pnpm build`，然后在仓库根目录执行：

```sh
CFT="$HOME/.cache/chrome-for-testing/156.0.8078.80/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
"$CFT" \
  --user-data-dir="$HOME/.cache/xsj-e2e/profile" \
  --remote-debugging-port=9333 \
  --load-extension="$PWD/.output/chrome-mv3" \
  --disable-features=DisableLoadExtensionCommandLineSwitch,TcpPortRandomizationMac \
  --no-first-run --no-default-browser-check \
  >"$HOME/.cache/xsj-e2e/chrome.log" 2>&1 &
```

两个必须的 feature 开关：

- `DisableLoadExtensionCommandLineSwitch`：不关掉的话，`--load-extension` 不生效。
- `TcpPortRandomizationMac`：不关掉就没网，原因见下一节。
- `--disable-features` 只认最后一个，两个开关必须合并成一个逗号列表，不能分开写两次。

### 为什么不关 `TcpPortRandomizationMac` 就没网

本机的 Shadowrocket 用 TUN 模式（utun 网卡，fake-IP `198.18.x`）接管流量，没有系统代理。

CfT 会默认套用 Chromium 内置的实验配置，正式版 Chrome 和 Brave 不会。其中 `TcpPortRandomizationMac` 会让每个 TCP socket 先绑定一个随机本地端口（`bind(0.0.0.0, 随机端口)`），再去 `connect`。在本机上，这样的 socket 会从物理网卡 en0 出去，不进 utun：

1. DNS 正常，拿到的是 fake-IP。
2. TCP 包从 en0 直接发给路由器，fake-IP 没人认，连接卡在 `SYN_SENT` 直到超时。
3. UDP/QUIC 不受影响，所以会出现 Google 能开、力扣和 GitHub 打不开的现象。

`--proxy-server=http://127.0.0.1:1082`（Shadowrocket 本地代理）也能绕开这个问题，但现在不需要了。

怀疑没网时，看网络进程 TCP 连接的源地址。源地址是 `198.18.0.1` 才说明走了 TUN；如果是局域网 IP（`192.168.x.x`），说明这个开关没生效：

```sh
NP=$(pgrep -f 'Chrome for Testing Helper.*network.mojom.NetworkService' | head -1)
lsof -nP -a -p "$NP" -iTCP | awk 'NR>1{print $9, $10}'
```

## 4. 用 CDP 驱动

```sh
node ~/.cache/xsj-e2e/cdp.mjs list                   # 列出 target
node ~/.cache/xsj-e2e/cdp.mjs open <url>             # 后台新开标签页
node ~/.cache/xsj-e2e/cdp.mjs eval <匹配> '<表达式>'  # 在页面里执行，支持 await
node ~/.cache/xsj-e2e/cdp.mjs close <匹配>
node ~/.cache/xsj-e2e/cdp.mjs quit                   # 关闭浏览器
```

- 端口默认 9333，可以用 `CDP_PORT` 覆盖。
- 脚本只附加页面，不附加 service worker，避免调试器让 SW 常驻、掩盖生命周期问题。

## 5. 扩展与常见场景

- 开发版扩展 ID 由加载路径决定。从 `~/code/leetcode-reminder/.output/chrome-mv3` 加载时是 `hgmiokipkhheipbdacacpfbeddedepec`，面板是 `chrome-extension://<ID>/dashboard.html#settings`。换 worktree 或换路径加载，ID 会变。
- 重新 `pnpm build` 之后，要重启浏览器，或在 `chrome://extensions` 里重新加载扩展。
- profile 里同时装着商店版扩展（`opapaiklmeajplnnllobegdgcodceihc`），力扣页上会叠两张卡（两个 `xiaoshuaji-review-ui` 宿主）。看开发版时，把另一张的 shadowRoot 里的 `.xsj-root` 隐藏掉。宿主上有 `:host{all:initial !important}`，直接改宿主样式无效。
- **测中途取消、切页、关面板**：测试账号题目很少，导入几秒就结束了。可以运行 `node ~/.cache/xsj-e2e/slow-import.mjs <毫秒>`，它会给 GraphQL 请求加延迟。
- **停 SW**：在 `chrome://serviceworker-internals` 里，点对应扩展的 `cr-button[data-command=stop]`。
- **测商店版**：启动时不带 `--load-extension`，打开 `https://chromewebstore.google.com/detail/opapaiklmeajplnnllobegdgcodceihc`，点 Add to Chrome。确认框是原生弹窗，CDP 点不到，需要请用户手动点 "Add extension"。
- **无头截图**：用 `--headless=new` 加临时 `--user-data-dir`，同样要带上第 3 节的 `--disable-features`。
  - 启动后会有两个 `background.js` service worker，另一个是 Chrome 自带组件，要按扩展 ID 认我们的。
  - 示例数据用 `backup.import`（replace）灌入。导入时后台会重放 FSRS，所以造数据只需要写评分和时间。
  - 同一页面只改 hash 不会重新拉数据，换页前先导航到 `about:blank`。
