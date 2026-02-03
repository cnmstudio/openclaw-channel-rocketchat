# Rocket.Chat Channel Plugin for OpenClaw - Project Summary

## Overview
This project implements a Rocket.Chat channel plugin for OpenClaw, allowing bidirectional communication between OpenClaw and Rocket.Chat instances. The plugin uses webhook-based communication to receive messages from Rocket.Chat and send responses back.

## Architecture

### Core Components
1. **index.ts** - Main plugin entry point that registers the channel with OpenClaw
2. **src/types.ts** - Type definitions for the plugin
3. **src/config-schema.ts** - Configuration schema using Zod validation
4. **src/channel.ts** - Main channel implementation with message handling logic
5. **src/runtime.ts** - Runtime management utilities
6. **src/webhook-handler.ts** - Webhook request processing handlers
7. **utils.ts** - Utility functions for masking, cleanup, and retries

### Message Flow
1. Rocket.Chat sends a webhook request to OpenClaw at `/hooks/rocketchat/{accountId}`
2. The webhook handler validates the request token and processes the message
3. The message is normalized and passed through OpenClaw's standard processing pipeline
4. Responses are sent back to Rocket.Chat using the configured webhook URL

## Key Features Implemented

### 1. Inbound Message Handling
- Receives webhook payloads from Rocket.Chat
- Validates authentication tokens
- Parses message content and context
- Routes messages to appropriate OpenClaw agents

### 2. Outbound Message Handling
- Sends responses back to Rocket.Chat via configured webhook
- Supports both text and markdown formats
- Handles direct messages and channel messages

### 3. Security Features
- Token-based authentication for incoming webhooks
- Configurable DM and group policies (open/allowlist/pairing)
- Sensitive data masking in logs

### 4. Configuration Options
- webhookUrl: Rocket.Chat webhook URL for sending messages
- authToken: Authentication token for validating incoming messages
- dmPolicy/groupPolicy: Access control policies
- messageType: Text or markdown message format
- Debug mode for troubleshooting

## Rocket.Chat Integration

### Outgoing Webhook Setup
To use this plugin, configure an outgoing webhook in Rocket.Chat:
- Event Trigger: `Message Sent`
- URLs: `https://your-openclaw-server/hooks/rocketchat/default`
- Token: The same token configured in OpenClaw

### Supported Payload Formats
#### Incoming (from Rocket.Chat):
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

#### Outgoing (to Rocket.Chat):
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

## Implementation Details

### Security Measures
- All sensitive tokens are masked in logs
- Authentication token verification for incoming requests
- Configurable access control lists

### Error Handling
- Comprehensive error catching and logging
- Graceful degradation when optional features aren't available
- Retry mechanisms with exponential backoff

### Performance Considerations
- Minimal memory footprint
- Efficient message processing
- Proper cleanup of temporary resources

## Installation and Usage

### Installation
```
openclaw plugins install /path/to/rocketchat-channel
```

### Configuration
Add to your OpenClaw configuration:
```json
{
  "channels": {
    "rocketchat": {
      "enabled": true,
      "webhookUrl": "YOUR_ROCKETCHAT_WEBHOOK_URL",
      "authToken": "YOUR_AUTH_TOKEN",
      "dmPolicy": "open",
      "messageType": "markdown"
    }
  }
}
```

### Dependencies
- axios: For HTTP requests
- zod: For configuration validation
- openclaw: Plugin SDK

## Future Enhancements

Potential areas for future development:
1. Media/file attachment support
2. Rich message formatting
3. Threaded message support
4. Presence and typing indicators
5. Advanced message filtering

## Testing

The plugin follows the same architectural patterns as the reference DingTalk plugin, ensuring consistency with the OpenClaw ecosystem. It includes proper error handling, logging, and security measures while maintaining compatibility with OpenClaw's channel plugin interface.