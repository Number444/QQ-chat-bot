# QQ 机器人（NapCat Shell × DSH headless）

Four 的私人 QQ 机器人：大号私聊 / 群里@小号 → 「艾薇」（DSH headless 会话，带全局记忆与技能）自动应答。

## 组成

| 组件 | 说明 |
|---|---|
| NapCat Shell | 无头 QQNT 协议端（不入库），OneBot 11 HTTP `:3000`，WebUI `:6099` |
| `bot.cjs` | 机器人大脑：webhook `:3210` 收事件 → dsh headless 生成回复 → OneBot 发回 |
| `start-bot.bat` | 一键启动（需管理员），拉起 NapCat + bot.cjs |

## 启动 / 停止

**启动**：管理员运行 `start-bot.bat`（或按技能档案 `qq-bot` 手动两步）。弹出的两个窗口不能关。

**验证**：
```powershell
Invoke-RestMethod http://127.0.0.1:3000/get_login_info   # 应返回小号 IV 在线
Get-NetTCPConnection -State Listen -LocalPort 3210        # bot 大脑在听
```

**停止**：
```powershell
Stop-Process -Name NapCatWinBootMain,QQ -Force            # NapCat
# bot：按命令行找 node 进程杀掉（勿误杀其他 node）
```

**WebUI**：`http://127.0.0.1:6099/webui?token=49be5099be33`

## 行为准则

- 只响应：大号 `2337529577` 私聊 + 群聊@小号 `2721212523`，其余静默
- 人格 = 艾薇助手身份；简短口语化回复；忽略自身消息防循环
- OneBot 网络配置改动须重启 NapCat 生效（不热加载）
- 不开机自启（Four 定调），用时通知艾薇启动

## 日志

`bot.log`（收发记录）、NapCat 控制台窗口。

## 注意

- 本仓库为白名单 git：只跟踪 `bot.cjs` / `README.md` / `start-bot.bat` / `.gitignore`；NapCat 二进制、config（含 token）、日志一律忽略
- 详细操作手册与踩坑集见记忆技能 `~/.dsh/skills/qq-bot.md`
