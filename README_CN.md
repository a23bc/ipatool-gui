# IPATool GUI

<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="IPATool GUI" />
</p>

<p align="center">
  <b>给 <a href="https://github.com/majd/ipatool">ipatool</a> 的桌面图形界面</b><br/>
  搜索 App Store · 浏览历史版本 · 按 Apple ID 下载 .ipa / .pkg
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README_CN.md">中文</a>
</p>

---

## 简介

**IPATool GUI** 是跨平台桌面应用（Windows / macOS / Linux）。它不重新实现 Apple 协议，
而是把命令行工具 [ipatool](https://github.com/majd/ipatool) 做成好用的 GUI：
搜应用、看版本、排队下载、管理多个 Apple ID。

**仓库不包含 ipatool 本体。** 首次运行会从官方 GitHub Releases 自动下载并校验 SHA-256。

### 功能一览

| | |
| --- | --- |
| **搜索** | 关键字 / Bundle ID，按平台筛选，结果图标，搜索历史 |
| **版本历史** | 查看全部历史版本，可下载任意指定版本 |
| **已购项目** | 分页浏览名下应用，多选批量下载 |
| **下载队列** | 并行下载、真·暂停/继续（断点续传）、重试、排序、速度与剩余时间、跨重启保留 |
| **多账户** | 多个 Apple ID 并存，一键切换，会话互相隔离 |
| **登录** | 两步验证（2FA）直接在应用内完成；支持邮箱或手机号 Apple ID |
| **批量导入** | 文本 / JSON / App Store 链接一键导入下载列表 |
| **活动日志** | 每次调用的完整输出，密钥自动脱敏，可过滤导出 |
| **界面** | 深色 / 浅色主题，中英双语，命令面板（Ctrl/⌘ + K） |

### 截图

> 截图待补。应用为深色优先的现代界面，列表全虚拟化滚动。

---

## 安装

到 [Releases](https://github.com/a23bc/ipatool-gui/releases/latest) 下载对应平台的安装包。

### macOS

构建产物是 **ad-hoc 签名、未公证** 的应用。首次打开时 Gatekeeper 可能提示
**「IPATool GUI」已损坏，无法打开**——这**不是文件损坏**，而是未通过公证校验。
解压后执行一次：

```bash
xattr -dr com.apple.quarantine "/Applications/IPATool GUI.app"
```

注意：

- `-r` 不能省（应用包内部也有带标记的文件）；
- macOS 15+ 的「右键 → 打开」已无法绕过，这条命令是最省事的路径；
- 请用 **Finder 双击解压** 或终端 `tar -xzf`（保留符号链接与可执行位）。

### Windows

SmartScreen 提示「未知发布者」属正常现象，选择「仍要运行」即可。

### Linux

提供 AppImage 与 deb（x64 / arm64）。

---

## 快速开始

1. **安装应用**并启动，按向导安装/检测 ipatool 引擎（可自动完成）。
2. **登录 Apple ID**：邮箱或手机号 + 密码；若开启两步验证，在应用内输入验证码即可。
3. **搜索应用** → 打开详情/版本 → **下载**。下载会进入队列，可暂停、继续、重试。

### 网络提示

部分网络环境下，Apple 的购买/下载接口（如 `p47-buy.itunes.apple.com`）
可能无法直连。若下载前获取凭证失败，请配置系统代理或 VPN 后重试。

---

## 本地开发

```bash
npm install          # Node 20.19+
npm run dev          # 启动 Electron + Vite HMR
npm run typecheck && npm test && npm run lint
```

打包：

```bash
npm run dist:win     # Windows NSIS + portable
npm run dist:mac     # macOS（未签名）
npm run dist:linux   # AppImage + deb
```

更多构建、测试与发布细节见 [docs/architecture.md](docs/architecture.md)。

---

## 深入了解

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 多账户模型、暂停续传原理、进度解析、安全模型、打包与 CI、代码地图 |
| [安全披露](docs/architecture.md#安全披露) | 漏洞请走 Private vulnerability reporting，勿开公开 issue |

几个值得知道的设计点（细节在文档里）：

- **多账户真正隔离**：每个账户独立的 ipatool 会话目录 + HOME 沙箱，切换不串号。
- **暂停 = 真暂停**：利用 ipatool 的 HTTP Range 续传，不是取消重来。
- **凭据不落明文**：系统钥匙串 / safeStorage 加密；不可用时拒绝保存而不是写明文。
- **不自动更新**：未签名的 auto-update 通道有安全风险，更新只做提示。

---

## 请合规使用

请只下载你有权获取的应用。自动化访问 App Store 可能触发 Apple 限流或账户标记。

本项目是 [majd/ipatool](https://github.com/majd/ipatool)（MIT）的第三方前端，不重新分发 ipatool。

**License:** [MIT](LICENSE)
