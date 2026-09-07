# YB Digest

一个同时支持 **YouTube 和 Bilibili** 的 Chrome / Edge 视频学习扩展，使用页面内弹窗。
根目录是合并后的唯一运行项目，无需构建、无需安装 npm 依赖。

## 主要功能

- **双平台字幕**：获取 YouTube / Bilibili 原生字幕，支持搜索、时间戳跳转、顺句和双语阅读。
- **页面内弹窗**：在视频页直接操作，绑定当前标签页；关闭弹窗会取消其未完成的 AI 任务。
- **视频总结与概览**：总结核心主题、主要内容和观点，或生成章节时间线与金句；支持长视频分块处理。
- **问答与笔记**：围绕视频字幕提问，保存带时间戳的笔记，并按需使用 AI 润色。
- **本地保存与导出**：学习资料按视频独立保存，支持 Markdown 导出和 JSON 备份恢复。

## 安装

1. 打开 `chrome://extensions` 或 `edge://extensions`，启用开发者模式。
2. 点击「加载已解压的扩展程序」，选择本目录 `yb-digest`（包含 `manifest.json`）。
3. 禁用原来的两个独立扩展，避免页面出现重复按钮。
4. 打开视频，点击页面 Digest 按钮或浏览器工具栏的扩展图标。

**不要直接打开 sidepanel.html**：这是浏览器扩展，依赖扩展 API，不是普通网页，也不需要开发服务器。

## 配置

| 功能 | 配置要求 |
| --- | --- |
| Bilibili 字幕 | 无需字幕密钥；部分字幕需要先在浏览器登录 B 站 |
| YouTube 字幕 | 设置页填写 Supadata API Key，点击「保存字幕设置」；不要求同时配置 AI |
| AI 总结、概览、双语翻译、划词解释、视频问答、笔记润色 | 选择 AI 服务商，填写自己的密钥和模型，点击「保存并授权」 |

YouTube 沿用原项目的 [Supadata](https://supadata.ai) 原生字幕接口
（`mode=native`），不自动调用音频转录。无字幕、额度不足、失效密钥会明确提示。
可配置首选字幕语言，也可在视频的字幕轨菜单切换已有语言。
字幕自动分段；中文可顺句补标点，中文字幕译成英文，外文字幕译成中文。

AI 支持原 Bilibili 项目的 OpenAI 兼容协议和 Anthropic 协议，包括 DeepSeek、
OpenAI、Gemini、Claude、自定义接口和本机 Ollama。
自定义接口允许 HTTP 和 HTTPS，并在保存时按地址申请访问权限。
HTTP 会明文传输密钥和请求内容，建议优先使用 HTTPS。

## 双平台行为

- YouTube：`www.youtube.com/watch`、`/shorts/`、`/live/`；从首页站内跳转同样有效。
- Bilibili：BV 播放页、`list` 合集页（`bvid` 参数）和 `p` 分 P。
- 两个平台共用字幕、总结、概览、问答、笔记、搜索、导出及设置页。
- 点击页面 Digest 或工具栏图标，在当前视频页内打开弹窗，不再使用浏览器侧边栏。
- 弹窗固定绑定当前视频和标签页，切换浏览器标签页不会串台；关闭弹窗、关闭标签页或切换视频/分 P 时，取消该弹窗未完成的 AI 请求。已经保存的结果保留。
- 切换到另一个视频后再次点击 Digest 打开新弹窗；字幕和笔记时间戳定位到对应平台的视频。
- 笔记、学习资料和缓存按视频独立存储，B 站分 P 单独区分。
- 不支持没有原生字幕的视频、B 站番剧/直播、YouTube 音频转录。

## 视频总结

弹窗「总结」页点击「生成总结」，提炼一句话核心、主要内容、主要观点和结论与启示。
「概览」仍保留章节时间线和金句，两者独立生成、独立保存。
长视频会覆盖全部字幕，分块提炼后逐层综合，不只截取开头；B 站按当前分 P 总结。
总结可停止、重新生成、复制或导出 Markdown；学习资料备份包含总结，字幕缓存淘汰后仍保留。
关闭弹窗会中止客户端 AI 请求和后续分块，但无法撤销服务商已处理的请求或计费。
播放器上的独立「笔记」按钮不属于弹窗任务，保存行为不受弹窗开关影响。

## 项目结构

```text
manifest.json / background.js   一个扩展与一个后台服务
content.js                     两个平台的按钮、笔记和播放器控制
sidepanel.* / options.*         弹窗内共用界面与设置页
lib/page-dialog.js             页内弹窗容器与关闭操作
lib/panel-client.js            弹窗与后台的连接
lib/panel-sessions.js          视频绑定、任务隔离与关闭取消
lib/video-platform.js          平台识别、视频标识与链接
lib/youtube-api.js             YouTube / Supadata 字幕适配
lib/bili-api.js / lib/wbi.js    Bilibili 官方字幕适配
lib/transcript-service.js      统一字幕管线和缓存
lib/summary-service.js         全视频总结、分块提炼与逐层综合
lib/*-service.js               共用 AI、问答和笔记服务
tests/                        单元和集成回归测试
```

为兼容 Bilibili 原来的数据格式，内部保留 `bvid` 字段及 `bili_*` 存储名称。
Bilibili 标识仍为 `BV...`，YouTube 使用 `yt:<videoId>`，不会相互覆盖。
备份格式的 `kind` 仍保留 `bilibili-digest-backup`，可恢复旧 Bilibili JSON 备份。

**旧数据不会自动跨扩展迁移**：浏览器按扩展 ID 隔离存储。加载新的根目录可能产生
新的扩展 ID。请先在旧 Bilibili 扩展导出备份，再在新版恢复；旧 YouTube 扩展的
Markdown 笔记导出可保留，但本次没有实现其私有存储到新版的自动迁移。
API 密钥需要在新版重新配置，备份不含密钥。

## 验证与打包

需要 Node.js 20+（建议 24）；运行时没有第三方 npm 依赖。

```sh
npm test
npm run package
```

打包使用白名单，不包含测试、浏览器配置或密钥。

更新代码或权限声明后，必须在 `chrome://extensions` / `edge://extensions` 中
重新加载扩展（本版为 0.6.0），再刷新视频页面、关闭并重新打开设置页。仅刷新设置页不会更新清单。

可选浏览器冒烟测试：环境中安装 Playwright 与 Chromium 后运行
`node scripts/smoke-extension.js`。它使用独立临时浏览器配置、模拟视频页面和预置缓存，
不访问真实账号或消耗 API 额度。真实字幕和 AI 服务还需要自己的账号与密钥验证。

若只有本机 Chrome，可运行 `node scripts/smoke-extension.js --ui-only`：
使用模拟扩展 API 验证界面和响应式布局，不替代真实扩展安装测试。

## 原项目与致谢

本项目由以下两个开源项目合并而来，原仓库地址如下：

| 原项目 | 仓库地址 | 合并内容 |
| --- | --- | --- |
| Bilibili Digest | [biuworks/bilibili-digest](https://github.com/biuworks/bilibili-digest) | 以 0.4.4 的模块化实现为基础，保留 B 站字幕获取、AI 服务、问答、笔记和本地存储能力 |
| YouTube Digest Multilingual Language Learning Multi-AI | [Beccaa2023/YouTube-Digest-Multilingual-Language-Learning-Multi-AI](https://github.com/Beccaa2023/YouTube-Digest-Multilingual-Language-Learning-Multi-AI) | 合入 1.2.0 的 YouTube / Supadata 原生字幕流程 |

合并版统一了双平台入口、设置和数据标识，并增加页面内弹窗与全视频总结。

同时感谢更早的上游项目 [zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest)。
MIT 授权与上游版权声明保留在 [LICENSE](LICENSE)。

## 隐私

详细网络和数据行为见 [PRIVACY.md](PRIVACY.md)。
