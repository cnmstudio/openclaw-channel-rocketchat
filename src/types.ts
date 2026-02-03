import type { OpenClawConfig } from 'openclaw/plugin-sdk';

// Rocket.Chat 配置类型定义
export interface RocketChatConfig {
  enabled?: boolean;
  webhookUrl: string;           // Rocket.Chat 发送消息的 Webhook 地址
  authToken: string;            // 用于验证消息的安全令牌
  dmPolicy?: 'open' | 'pairing' | 'allowlist';
  groupPolicy?: 'open' | 'allowlist';
  allowFrom?: string[];
  messageType?: 'text' | 'markdown';
  showThinking?: boolean;
  debug?: boolean;
  name?: string;
  accounts?: Record<string, RocketChatConfig>;
}

export interface RocketChatChannelConfig {
  [key: string]: RocketChatConfig;
}

// 接收的 Rocket.Chat 消息格式
export interface RocketChatInboundMessage {
  token: string;                // 验证令牌
  bot: boolean;                 // 是否为机器人消息
  channel_id: string;           // 频道 ID
  channel_name: string | null;  // 频道名称
  message_id: string;           // 消息 ID
  timestamp: string;            // 时间戳
  user_id: string;              // 用户 ID
  user_name: string;            // 用户名
  text: string;                 // 消息文本
  siteUrl: string;              // 站点 URL
}

// 发送给 Rocket.Chat 的消息格式
export interface RocketChatOutboundMessage {
  text: string;
  attachments?: Array<{
    title: string;
    title_link?: string;
    text: string;
    image_url?: string;
    color?: string;
  }>;
}

// 消息内容解析结果
export interface MessageContent {
  text: string;
  messageType: string;
  mediaPath?: string;
  mediaType?: string;
}

// 发送消息选项
export interface SendMessageOptions {
  useMarkdown?: boolean;
  title?: string;
  atUserId?: string | null;
  log?: Logger;
}

// 媒体文件类型
export interface MediaFile {
  path: string;
  mimeType: string;
}

// 处理 Rocket.Chat 消息参数
export interface HandleRocketChatMessageParams {
  cfg: OpenClawConfig;
  accountId: string;
  data: RocketChatInboundMessage;
  sessionWebhook: string;
  log: Logger;
  rocketchatConfig: RocketChatConfig;
}

// 主动发送消息载荷
export interface ProactiveMessagePayload {
  text: string;
  attachments?: Array<{
    title: string;
    title_link?: string;
    text: string;
    image_url?: string;
    color?: string;
  }>;
}

// 会话 Webhook 响应
export interface SessionWebhookResponse {
  text: string;
  attachments?: Array<{
    title: string;
    title_link?: string;
    text: string;
    image_url?: string;
    color?: string;
  }>;
}

// Axios 响应类型
export interface AxiosResponse {
  [key: string]: any;
}

// 日志记录器接口
export interface Logger {
  info?: (message: string, ...args: any[]) => void;
  debug?: (message: string, ...args: any[]) => void;
  warn?: (message: string, ...args: any[]) => void;
  error?: (message: string, ...args: any[]) => void;
}

// 网关启动上下文
export interface GatewayStartContext {
  account: {
    accountId: string;
    config: RocketChatConfig;
    enabled: boolean;
  };
  cfg: OpenClawConfig;
  abortSignal?: AbortSignal;
  log?: Logger;
}

// 网关停止结果
export interface GatewayStopResult {
  stop: () => void;
}

// AI 卡片实例（如果需要扩展）
export interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  conversationId: string;
  createdAt: number;
  lastUpdated: number;
  state: string;
  config?: RocketChatConfig;
}

// AI 卡片流式请求
export interface AICardStreamingRequest {
  outTrackId: string;
  guid: string;
  key: string;
  content: string;
  isFull: boolean;
  isFinalize: boolean;
  isError: boolean;
}

// AI 卡片状态常量
export enum AICardStatus {
  PROCESSING = 'PROCESSING',
  INPUTING = 'INPUTING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
}