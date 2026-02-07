# @openclaw/kook

OpenClaw channel plugin for [KOOK](https://www.kookapp.cn/) (开黑啦) — a Chinese gaming community chat platform.

![Screenshot_2026-02-07-13-11-14-99_718c8cfc7a7dc4a17c28f7f62dcd3034](https://github.com/user-attachments/assets/2b9e2691-231d-4597-881f-7814fe5c740a)

## Features

- WebSocket gateway with auto-reconnect and exponential backoff
- Direct messages and group channel messages
- KMarkdown rich text formatting
- Image, video, audio, and file sending (uploads to KOOK CDN)
- @mention detection and `requireMention` gating per channel/guild
- Ack reactions (e.g. 👀) on inbound messages
- Multi-account support
- DM security policies: `open`, `pairing`, `allowlist`
- Group security policies: `open`, `allowlist`, `disabled`
- Per-group overrides for `requireMention`, `enabled`, and `allowFrom`
- Chat history context for group conversations

## Setup

### 1. Create a KOOK Bot

Go to the [KOOK Developer Portal](https://developer.kookapp.cn/) and create a bot application. Copy the bot token.

### 2. Install the plugin

```bash
# From npm
openclaw plugins install @openclaw/kook

# Or link locally for development
openclaw plugins install -l .
```

### 3. Configure

```bash
openclaw config set channels.kook.token '<your-bot-token>'
```

Or use an environment variable:

```bash
export KOOK_BOT_TOKEN='<your-bot-token>'
```

### 4. Allow a group channel

By default `groupPolicy` is `allowlist`, so you must add channel or guild IDs:

```bash
openclaw config set channels.kook.groupAllowFrom '["<channelId-or-guildId>"]'
```

### 5. Start

```bash
openclaw gateway restart
```

Verify with:

```bash
openclaw status
openclaw plugins list
```

## Configuration Reference

All options live under `channels.kook` in `openclaw.json`.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the KOOK channel |
| `token` | `string` | — | Bot token (or use `KOOK_BOT_TOKEN` env var) |
| `name` | `string` | — | Display name for this account |
| `dmPolicy` | `"open" \| "pairing" \| "allowlist"` | `"pairing"` | DM access policy |
| `allowFrom` | `string[]` | — | User IDs allowed to DM (for `allowlist` policy) |
| `groupPolicy` | `"open" \| "allowlist" \| "disabled"` | `"allowlist"` | Group channel access policy |
| `groupAllowFrom` | `string[]` | — | Guild/channel IDs allowed (for `allowlist` policy) |
| `requireMention` | `boolean` | `true` | Require @mention in group channels to trigger the bot |
| `textChunkLimit` | `number` | `4000` | Max characters per message chunk |
| `groups` | `object` | — | Per-channel/guild overrides (see below) |
| `accounts` | `object` | — | Multi-account configurations |

### Per-group overrides

```json
{
  "channels": {
    "kook": {
      "groups": {
        "<channelId-or-guildId>": {
          "enabled": true,
          "requireMention": false,
          "allowFrom": ["<userId>"]
        }
      }
    }
  }
}
```

### Multi-account

```json
{
  "channels": {
    "kook": {
      "token": "default-bot-token",
      "accounts": {
        "secondary": {
          "token": "another-bot-token",
          "groupPolicy": "open"
        }
      }
    }
  }
}
```

## Debugging

```bash
# Live gateway logs
openclaw gateway logs -f

# Foreground mode with debug output
OPENCLAW_LOG=debug openclaw gateway start --foreground

# Probe bot credentials
openclaw channels probe kook

# Check config
openclaw config get channels.kook
```

## Links

- [KOOK Developer Portal](https://developer.kookapp.cn/)
- [KOOK API Reference](https://github.com/kaiheila/api-docs)
- [KOOK Message API](https://developer.kookapp.cn/doc/http/message)
- [KOOK Asset API](https://developer.kookapp.cn/doc/http/asset)
- [KOOK Card Message Builder](https://www.kookapp.cn/tools/message-builder.html)

---

# @openclaw/kook

[KOOK](https://www.kookapp.cn/)（开黑啦）—— OpenClaw 频道插件，适用于中文游戏社区聊天平台。

## 功能特性

- WebSocket 网关连接，支持自动重连与指数退避
- 私聊与频道群聊消息收发
- KMarkdown 富文本格式
- 图片、视频、音频、文件发送（自动上传至 KOOK CDN）
- @提及检测与 `requireMention` 频道级控制
- 收到消息时自动添加确认表情（如 👀）
- 多账号支持
- 私聊安全策略：`open`（开放）、`pairing`（配对）、`allowlist`（白名单）
- 群聊安全策略：`open`（开放）、`allowlist`（白名单）、`disabled`（禁用）
- 按频道/服务器单独配置 `requireMention`、`enabled`、`allowFrom`
- 群聊历史上下文记录

## 安装配置

### 1. 创建 KOOK 机器人

前往 [KOOK 开发者平台](https://developer.kookapp.cn/) 创建机器人应用，复制 Bot Token。

### 2. 安装插件

```bash
# 从 npm 安装
openclaw plugins install @openclaw/kook

# 或本地开发链接
openclaw plugins install -l .
```

### 3. 配置 Token

```bash
openclaw config set channels.kook.token '<你的机器人Token>'
```

或使用环境变量：

```bash
export KOOK_BOT_TOKEN='<你的机器人Token>'
```

### 4. 允许群聊频道

默认 `groupPolicy` 为 `allowlist`（白名单），需要添加频道或服务器 ID：

```bash
openclaw config set channels.kook.groupAllowFrom '["<频道ID或服务器ID>"]'
```

### 5. 启动

```bash
openclaw gateway restart
```

验证：

```bash
openclaw status
openclaw plugins list
```

## 配置参考

所有选项位于 `openclaw.json` 的 `channels.kook` 下。

| 键 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| `enabled` | `boolean` | `true` | 启用/禁用 KOOK 频道 |
| `token` | `string` | — | 机器人 Token（或使用 `KOOK_BOT_TOKEN` 环境变量） |
| `name` | `string` | — | 账号显示名称 |
| `dmPolicy` | `"open" \| "pairing" \| "allowlist"` | `"pairing"` | 私聊访问策略 |
| `allowFrom` | `string[]` | — | 允许私聊的用户 ID 列表 |
| `groupPolicy` | `"open" \| "allowlist" \| "disabled"` | `"allowlist"` | 群聊访问策略 |
| `groupAllowFrom` | `string[]` | — | 允许的服务器/频道 ID 列表 |
| `requireMention` | `boolean` | `true` | 群聊中是否需要 @提及 才触发机器人 |
| `textChunkLimit` | `number` | `4000` | 单条消息最大字符数 |
| `groups` | `object` | — | 按频道/服务器的单独配置（见下文） |
| `accounts` | `object` | — | 多账号配置 |

### 按频道单独配置

```json
{
  "channels": {
    "kook": {
      "groups": {
        "<频道ID或服务器ID>": {
          "enabled": true,
          "requireMention": false,
          "allowFrom": ["<用户ID>"]
        }
      }
    }
  }
}
```

### 多账号配置

```json
{
  "channels": {
    "kook": {
      "token": "默认机器人Token",
      "accounts": {
        "secondary": {
          "token": "另一个机器人Token",
          "groupPolicy": "open"
        }
      }
    }
  }
}
```

## 调试

```bash
# 实时查看网关日志
openclaw gateway logs -f

# 前台模式运行，输出调试信息
OPENCLAW_LOG=debug openclaw gateway start --foreground

# 验证机器人凭据
openclaw channels probe kook

# 查看当前配置
openclaw config get channels.kook
```

## 相关链接

- [KOOK 开发者平台](https://developer.kookapp.cn/)
- [KOOK API 参考文档](https://github.com/kaiheila/api-docs)
- [KOOK 消息接口](https://developer.kookapp.cn/doc/http/message)
- [KOOK 媒体资源接口](https://developer.kookapp.cn/doc/http/asset)
- [KOOK 卡片消息编辑器](https://www.kookapp.cn/tools/message-builder.html)
