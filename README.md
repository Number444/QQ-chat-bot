# QQ-chat-bot（艾薇）

QQ 机器人「艾薇」—— NapCat Shell + OneBot 11 + [DeepSeek Harness](https://github.com/deepseek-ai)（dsh）ACP 长驻会话。

## 架构

```
QQ 消息 ──(NapCat / OneBot 11, :3000)──> bot.cjs webhook (:3210)
                                            │
                                            ├─ 路由：主人私聊 / 群内 @
                                            ├─ dsh --profile acp（长驻子进程）
                                            │    └─ 每个 QQ 会话一个持久 session（可 resume）
                                            └─ OneBot 回消息 / 发文件
```

- **NapCat Shell**：QQ 协议端（不入库），注入 QQNT，提供 OneBot 11 HTTP API（`127.0.0.1:3000`），WebUI `:6099`
- **bot.cjs**：大脑。webhook 收消息 → 构造场景提示词 → 转发给 dsh ACP → 回消息
- **dsh ACP**：`dsh --profile acp` 以 JSON-RPC stdio 长驻运行；每个 QQ 会话映射一个持久 dsh session（`sessions.json`），重启可 resume

## 触发方式与权限

| 入口 | 能力 |
|---|---|
| 主人私聊 | 全部工具（shell、文件、网络搜索、WebBridge 浏览器控制），可发本机文件 |
| 主人在群里 @ | 同上 |
| 普通群成员 @ | **仅** 网络搜索 + WebBridge 访问网址；提示词级注入防护 |

主人身份由 `user_id` 硬编码判定（`MASTER_ID`），不依赖昵称。只响应主人私聊与群内 @机器人，其余消息静默。

## 特性

- **看门狗**：15s 检查；无任何动静 150s 判卡死取消；工具执行期间豁免（ACP 在单次工具调用期间无事件）；10 分钟总上限；超时保留部分回复
- **状态播报**：每 150s 一条「已调用过哪些工具」的汇总，不逐条刷屏
- **分段回复**：按 assistant messageId 分段，每段立即作为独立气泡发出
- **模型自检**：每次 resume/new 校验模型与推理强度，不符则用 `session/set_config_option` 当场纠正
- **群聊 6h 闲置重建**：防上下文积压产生巨额读入费用；私聊不受影响
- **启动 janitor + 每小时扫描**：清理无映射的孤儿 session 目录（UUID 校验 + 1h 宽限 + 映射损坏时罢工）
- **`.scratch` 草稿目录**：agent 临时文件的指定堆放点（提示词约定），仅启动时清空
- **重启不清会话**：session 持久化跨重启，只有 6h 闲置 / resume 失败 / 手动删除才重置
- **NapCat 心跳殉葬**：60s 探测 `get_login_info`，连续 3 次失败则带走 ACP 子进程退出
- **发本机文件**：主人会话中输出 `[发送文件]绝对路径[/发送文件]`；图片/视频/语音走消息段直接显示，其他类型走 `upload_group_file` / `upload_private_file`；绝对路径 + 存在性 + 50MB 校验

## 启动 / 停止

**启动**：管理员运行 `start-bot.bat`（内部调用 `start-bot.ps1`：前置检查 dsh-app / dsh web 在线 → 提权 → 拉起 NapCat + bot → 探测 NapCat 登录与 bot 端口）。**NapCat 控制台窗口不能关**（关了协议端就死，bot 会因心跳失败跟着退出）。

**验证**：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/get_login_info   # NapCat 在线
Get-NetTCPConnection -State Listen -LocalPort 3210        # bot 大脑在听
```

**停止**：bot 是隐藏分离进程，关启动窗口杀不掉它。需同时结束 `bot.cjs` 与 `--profile acp` 两个 node 进程：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -match 'profile acp|bot\.cjs' } | % { Stop-Process -Id $_.ProcessId -Force }
```

只杀主进程会让 ACP 子进程孤儿化并占住 session 写锁，导致下次启动撞锁重建（丢会话记忆）。

## 配置

编辑 `bot.cjs` 顶部常量：`SELF_ID`（机器人 QQ）、`MASTER_ID`（主人 QQ）、`ONEBOT` 地址、路径常量。模型与技能配置在 `~/.dsh/profiles/acp/cordis.patch.yml`。

不开机自启，用时手动启动。

## 日志

`bot.log`（收发记录，不入库）、NapCat 控制台窗口。

## 注意

- 本仓库为白名单 git：只跟踪 `bot.cjs` / `README.md` / 启动脚本 / `.gitignore`；NapCat 二进制、config（含 token）、日志、`sessions.json` 一律忽略
