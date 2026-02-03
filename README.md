# Rocket.Chat Channel for OpenClaw

Rocket.Chat 机器人 Channel 插件，使用 Webhook 模式进行双向通信。

## 功能特性

- ✅ Webhook 模式 — 接收 Rocket.Chat 消息推送
- ✅ 消息发送 — 通过 Webhook 向 Rocket.Chat 发送消息
- ✅ 私聊支持 — 直接与机器人对话
- ✅ 群聊支持 — 在频道中 @机器人
- ✅ 多种消息类型 — 文本、附件
- ✅ Markdown 回复 — 支持富文本格式回复
- ✅ 完整 AI 对话 — 接入 OpenClaw 消息处理管道

## 安装

### 方法 A：通过远程仓库安装 (推荐)

直接运行 openclaw 插件安装命令，openclaw 会自动处理下载、安装依赖和注册：

```
openclaw plugins install https://github.com/your-repo/openclaw-channel-rocketchat.git
```

### 方法 B：通过本地源码安装

如果你想对插件进行二次开发，可以先克隆仓库：

```bash
# 1. 克隆仓库
git clone https://github.com/your-repo/openclaw-channel-rocketchat.git
cd openclaw-channel-rocketchat

# 2. 安装依赖 (必需)
npm install

# 3. 以链接模式安装 (方便修改代码后实时生效)
openclaw plugins install -l .
```

### 方法 C：手动安装

- 将本目录下载或复制到 ~/.openclaw/extensions/rocketchat。
- 确保包含 index.ts, openclaw.plugin.json 和 package.json。
- 运行 openclaw plugins list 确认 rocketchat 已显示在列表中。

## 配置

### 1. 在 Rocket.Chat 中设置 Outgoing WebHook

在 Rocket.Chat 管理界面中：

1. 进入 **管理** > **集成** > **传出 WebHook**
2. 点击 **新建传出 WebHook**
3. 配置如下：
   - **事件触发器**: `Message Sent`
   - **通道**: 你想监听的频道 (或留空监听所有)
   - **URLs**: `https://your-openclaw-server/hooks/rocketchat/default` (将 `your-openclaw-server` 替换为你的服务器地址)
   - **触发单词**: 可选，如果你想通过特定单词触发
   - **令牌**: 记住这个令牌，将在 OpenClaw 配置中使用

### 2. 配置 OpenClaw

在 ~/.openclaw/openclaw.json 的 channels 下添加：

```json
{
  ...
  "channels": {
    "telegram": { ... },

    "rocketchat": {
      "enabled": true,
      "webhookUrl": "https://your-rocket-chat-instance.com/hooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN",
      "authToken": "YOUR_WEBHOOK_TOKEN",
      "dmPolicy": "open",
      "groupPolicy": "open",
      "messageType": "markdown",
      "showThinking": true,
      "debug": false
    }
  },
  ...
}
```

### 3. 重启 Gateway

```bash
openclaw gateway restart
```

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| enabled | boolean | true | 是否启用 |
| webhookUrl | string | 必填 | Rocket.Chat 发送消息的 Webhook 地址 |
| authToken | string | 必填 | 用于验证消息的安全令牌 |
| dmPolicy | string | "open" | 私聊策略：open/pairing/allowlist |
| groupPolicy | string | "open" | 群聊策略：open/allowlist |
| allowFrom | string[] | [] | 允许的发送者 ID 列表 |
| messageType | string | "markdown" | 消息类型：text/markdown |
| showThinking | boolean | true | 显示思考提示 |
| debug | boolean | false | 是否开启调试日志 |

## 安全策略

### 私聊策略 (dmPolicy)

- open — 任何人都可以私聊机器人
- pairing — 新用户需要通过配对码验证
- allowlist — 只有 allowFrom 列表中的用户可以使用

### 群聊策略 (groupPolicy)

- open — 任何群都可以 @机器人
- allowlist — 只有配置的群可以使用

## 消息类型支持

### 接收

| 类型 | 支持 | 说明 |
|------|------|------|
| 文本 | ✅ | 完整支持 |
| 富文本 | ✅ | 提取文本内容 |
| 附件 | ✅ | 处理附件信息 |

### 发送

| 类型 | 支持 | 说明 |
|------|------|------|
| 文本 | ✅ | 完整支持 |
| Markdown | ✅ | 自动检测或手动指定 |

## 使用示例

配置完成后，在 Rocket.Chat 中：

- 私聊机器人 — 直接发送消息
- 群聊 @机器人 — 在频道中 @机器人名称 + 消息

## Webhook Payload 示例

Rocket.Chat 发送到你的 OpenClaw 实例的消息格式：

```json
{
  "token": "c15d7fa2-f85c-488c-8b50-5b8b0575e7a4",
  "bot": false,
  "channel_id": "CHANNEL_ID_EXAMPLE",
  "channel_name": null,
  "message_id": "MESSAGE_ID_EXAMPLE",
  "timestamp": "2026-02-02T06:00:00.139Z",
  "user_id": "USER_ID_EXAMPLE",
  "user_name": "username",
  "text": "Example message text",
  "siteUrl": "https://your-rocket-chat-instance.com"
}
```

你的插件向 Rocket.Chat 发送消息的格式：

```json
{
  "text": "Example message",
  "attachments": [
    {
      "title": "Rocket.Chat",
      "title_link": "https://rocket.chat",
      "text": "Rocket.Chat, the best open source chat",
      "image_url": "https://your-rocket-chat-instance.com/path/to/image.png",
      "color": "#764FA5"
    }
  ]
}
```