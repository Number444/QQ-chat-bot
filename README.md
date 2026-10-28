# QQ-chat-bot（SnowLuma 版）

IV（3776580862）在指定 QQ 群里的拟人群友机器人。当前链路为 **SnowLuma + OneBot v11 + 纯 Node `bot.cjs` + Kimi/OpenCode Go API**，不再使用 NapCat、QQBridge、AstrBot 或 DSH。

> 日常操作看 **操作手册.md**；历史设计推演看 **PLAN.md**（其中 NapCat 章节仅作归档）。

## 当前架构

```text
IV 的 QQ.exe
  └─ SnowLuma Hook（账号/进程级）
      └─ OneBot HTTP :3002 / WS :3003
          ├─ HTTP 上报 → bot.cjs webhook :3210
          └─ bot.cjs → Kimi / OpenCode Go API

bot.cjs 决定发言时 → OneBot :3002 → IV 发群消息
```

- **SnowLuma**：QQ 接入层，位于 `D:\Agent Space\SnowLuma`，WebUI 为 `http://127.0.0.1:5099/`。
- **controller.cjs**：SnowLuma 版 CLI，管理启动、停止、重启、状态、模型和闭嘴状态。
- **bot.cjs**：机器人本体，纯 Node 零 npm 依赖；负责人设、上下文、触发判定、成本护栏和表情包。
- **主号**：也可以被 SnowLuma Hook，但机器人业务只读取 `config.json` 指向的 IV OneBot。

## 启动

双击仓库内的 **`启动QQ机器人.bat`** 并接受一次 UAC：

1. 没有 QQ 时自动启动 QQ；已有 QQ 时不重复启动。
2. 自动以管理员权限启动 SnowLuma 并开启 Hook 自动加载。
3. 通过 IV 专属 OneBot 校验 `botQQ=3776580862`，账号不符时拒绝启动 bot。
4. 校验成功后启动 bot，并留下管理窗口。

QQ 默认登录哪个账号由 QQ 自己决定，脚本不会猜测；主号与 IV 多开时按各自 OneBot 端口隔离。若默认账号不是 IV，或 IV 尚未登录，按错误提示先在 QQ 中切换 IV，再执行 `start`。

也可以在**管理员终端**的仓库目录直接执行：

```powershell
node controller.cjs start
node controller.cjs status
node controller.cjs stop
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `start` | 启动 SnowLuma 和 bot，保留 QQ |
| `stop` | 停止 SnowLuma 和 bot，保留 QQ 与已加载 Hook |
| `restart` | 重启 SnowLuma 和 bot |
| `status` | 查看进程、模型、闭嘴状态、缓冲和 OneBot |
| `model` | 查看当前及可用模型 |
| `model k3.1-pro` | 切换模型，只重启 bot |
| `model k3-256k` | 切换到真实 K3，思考强度 low |
| `mute` | 闭嘴，只重启 bot |
| `unmute` | 恢复发言，只重启 bot；会产生真实群回复 |
| `log` / `err` | 查看日志 / 最近错误 |
| `tray` | 交互式控制器收进系统托盘 |
| `quit` | 退出控制器，可选择保留或停止服务 |

直接关控制器窗口等价于 `stop`，但**不会关闭 QQ**。

## 配置

- `config.json`：目标群、QQ 号、OneBot、模型、行为和成本护栏。
- `persona.md`：人设提示词。
- `secrets.json`：模型密钥与 OneBot `onebotAccessToken`，Git 忽略，绝不入库。
- `state/context.json`：当前模型、`muted`、群聊缓冲和摘要；修改前必须先停止 bot。
- `state/status.json`：每 10 秒刷新的运行状态。
- `SnowLuma/config/onebot_3776580862.json`：IV 的 OneBot 端口、token 和 HTTP 上报。

当前模型为 `k3.1-pro`（low），另注册 `k3-256k`（low）。模型切换通过 CLI 完成，不需要手改 JSON。

## 上下文与表情包

- 最近 75 条目标群消息写入 `state/context.json`。
- 本账号发送成功的文字和表情包也进入该缓冲，统一标记为“你（本账号）”，用于实时决策和滚动摘要；发送失败不记录，自身发言不会触发回复循环。
- 直接或引用的合并转发记录会展开为“昵称: 内容”；整块最多 30 条、2500 字，嵌套最多 2 层并去重防循环，图片以 `[图片]` 占位。
- 每 75 条生成滚动摘要，长期记忆位于 `state/memory.md`。
- 最近 10 张群图作为短期视觉上下文；大于 3.5MB 或过期图片会跳过。
- 群图会经模型打标、MD5 去重后进入 `memes/`；最多 500 个，决策时注入最近 40 个目录。
- `muted` 只禁止回复，仍可能接收消息、更新上下文并对图片打标。
- `state/`、`logs/`、`memes/`、`secrets.json` 和运行日志均不进入 Git。

## 注意

- Hook 针对 QQ 账号/进程，不针对某个群；bot 只处理 `config.json` 中的目标群（当前 `985100027`）。
- 主号使用 OneBot `:3000/:3001`，IV 使用 `:3002/:3003`，避免多账号端口冲突。
- SnowLuma 当前有“私聊上报不可用”警告；QQ 私聊主控命令不作为可靠管理入口，请使用 CLI。
- 不做开机自启；旧 NapCat 脚本和文档不再适用于当前链路。
