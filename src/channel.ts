import axios from 'axios';
import type { OpenClawConfig } from 'openclaw/plugin-sdk';
import { buildChannelConfigSchema } from 'openclaw/plugin-sdk';
import { maskSensitiveData, cleanupOrphanedTempFiles, retryWithBackoff } from '../utils';
import { getRocketChatRuntime } from './runtime';
import { RocketChatConfigSchema } from './config-schema.js';
import type {
  RocketChatConfig,
  RocketChatInboundMessage,
  RocketChatOutboundMessage,
  MessageContent,
  SendMessageOptions,
  MediaFile,
  HandleRocketChatMessageParams,
  ProactiveMessagePayload,
  SessionWebhookResponse,
  AxiosResponse,
  Logger,
  GatewayStartContext,
  GatewayStopResult,
} from './types';

// Global logger reference for use across module methods
let currentLogger: Logger | undefined;

// Target to active AI Card instance ID mapping (accountId:conversationId -> cardInstanceId)
// Used to quickly lookup existing active cards for a target
const activeCardsByTarget = new Map<string, string>();

// Authorization helpers
type NormalizedAllowFrom = {
  entries: string[];
  entriesLower: string[];
  hasWildcard: boolean;
  hasEntries: boolean;
};

/**
 * Normalize allowFrom list to standardized format
 */
function normalizeAllowFrom(list?: Array<string>): NormalizedAllowFrom {
  const entries = (list ?? []).map((value) => String(value).trim()).filter(Boolean);
  const hasWildcard = entries.includes('*');
  const normalized = entries
    .filter((value) => value !== '*')
    .map((value) => value.replace(/^(rocketchat|rc|rocket):/i, ''));
  const normalizedLower = normalized.map((value) => value.toLowerCase());
  return {
    entries: normalized,
    entriesLower: normalizedLower,
    hasWildcard,
    hasEntries: entries.length > 0,
  };
}

/**
 * Check if sender is allowed based on allowFrom list
 */
function isSenderAllowed(params: {
  allow: NormalizedAllowFrom;
  senderId?: string;
}): boolean {
  const { allow, senderId } = params;
  if (!allow.hasEntries) return true;
  if (allow.hasWildcard) return true;
  if (senderId && allow.entriesLower.includes(senderId.toLowerCase())) return true;
  return false;
}

/**
 * Get the current logger instance
 * Useful for methods that don't receive log as a parameter
 */
function getLogger(): Logger | undefined {
  return currentLogger;
}

// Helper function to detect markdown
function detectMarkdown(text: string, options: SendMessageOptions): boolean {
  const hasMarkdown = /^[#*>-]|[*_`#[\]]/.test(text) || text.includes('\n');
  return options.useMarkdown !== false && (options.useMarkdown || hasMarkdown);
}

function getConfig(cfg: OpenClawConfig, accountId?: string): RocketChatConfig {
  const rocketchatCfg = cfg?.channels?.rocketchat as RocketChatConfig | undefined;
  if (!rocketchatCfg) return {} as RocketChatConfig;

  if (accountId && rocketchatCfg.accounts?.[accountId]) {
    return rocketchatCfg.accounts[accountId];
  }

  return rocketchatCfg;
}

function isConfigured(cfg: OpenClawConfig, accountId?: string): boolean {
  const config = getConfig(cfg, accountId);
  return Boolean(config.webhookUrl && config.authToken);
}

// Send proactive message to Rocket.Chat
async function sendProactive(
  config: RocketChatConfig,
  target: string,
  text: string,
  options: SendMessageOptions = {}
): Promise<AxiosResponse> {
  const log = options.log || getLogger();

  log?.debug?.(`[RocketChat] Sending proactive message to target ${target}`);

  const payload: RocketChatOutboundMessage = {
    text,
  };

  // If markdown is detected, we can enhance the payload
  if (detectMarkdown(text, options)) {
    // Rocket.Chat supports markdown natively, so we can send the text as-is
    payload.text = text;
  }

  log?.debug?.(`[RocketChat] Sending payload: ${JSON.stringify(payload)}`);

  // Use the configured webhookUrl to send messages to Rocket.Chat
  // According to Rocket.Chat webhook format, we don't need Authorization header
  const result = await axios({
    url: config.webhookUrl,
    method: 'POST',
    data: payload,
    headers: { 
      'Content-Type': 'application/json'
      // No Authorization header needed for Rocket.Chat outgoing webhooks
    },
  });
  
  return result.data;
}

// Send message via sessionWebhook
async function sendBySession(
  config: RocketChatConfig,
  sessionWebhook: string,
  text: string,
  options: SendMessageOptions = {}
): Promise<AxiosResponse> {
  const useMarkdown = detectMarkdown(text, options);

  let body: SessionWebhookResponse;
  if (useMarkdown) {
    let finalText = text;
    if (options.atUserId) finalText = `${finalText} @${options.atUserId}`;
    body = { text: finalText };
  } else {
    body = { text };
  }

  if (options.atUserId) {
    // Add mention information if needed
    body.text = `${body.text} @${options.atUserId}`;
  }

  // For responses to incoming messages, we should use the configured webhookUrl
  // rather than the sessionWebhook URL which may be the incoming request URL
  // Instead, use the configured webhookUrl for sending replies
  const result = await axios({
    url: config.webhookUrl, // Use the configured webhook URL for sending
    method: 'POST',
    data: body,
    headers: { 
      'Content-Type': 'application/json'
    },
  });
  
  return result.data;
}

// Send message with automatic mode selection
async function sendMessage(
  config: RocketChatConfig,
  conversationId: string,
  text: string,
  options: SendMessageOptions & { sessionWebhook?: string; accountId?: string } = {}
): Promise<{ ok: boolean; error?: string; data?: AxiosResponse }> {
  try {
    const log = options.log || getLogger();

    // Prefer sessionWebhook for responses to incoming messages
    if (options.sessionWebhook) {
      await sendBySession(config, options.sessionWebhook, text, options);
      return { ok: true };
    }

    // Otherwise, use proactive messaging
    const result = await sendProactive(config, conversationId, text, options);
    return { ok: true, data: result };
  } catch (err: any) {
    options.log?.error?.(`[RocketChat] Send message failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Extract message content from Rocket.Chat inbound message
function extractMessageContent(data: RocketChatInboundMessage): MessageContent {
  return { 
    text: data.text?.trim() || '', 
    messageType: 'text' 
  };
}

// Message handler
async function handleRocketChatMessage(params: HandleRocketChatMessageParams): Promise<void> {
  const { cfg, accountId, data, sessionWebhook, log, rocketchatConfig } = params;
  const rt = getRocketChatRuntime();

  // Save logger reference globally for use by other methods
  currentLogger = log;

  log?.debug?.('[RocketChat] Full Inbound Data:', JSON.stringify(maskSensitiveData(data)));

  // Verify auth token
  if (data.token !== rocketchatConfig.authToken) {
    log?.warn?.(`[RocketChat] Invalid auth token received: ${data.token}`);
    return;
  }

  // 1. 过滤机器人自身消息
  if (data.bot) {
    log?.debug?.('[RocketChat] Ignoring robot self-message');
    return;
  }

  const content = extractMessageContent(data);
  if (!content.text) return;

  const isDirect = !data.channel_name || data.channel_name.startsWith('@'); // Assuming DMs start with @
  const senderId = data.user_id;
  const senderName = data.user_name || 'Unknown';
  const channelId = data.channel_id;
  const channelName = data.channel_name || 'Direct Message';

  // 2. Check authorization for direct messages based on dmPolicy
  let commandAuthorized = true;
  if (isDirect) {
    const dmPolicy = rocketchatConfig.dmPolicy || 'open';
    const allowFrom = rocketchatConfig.allowFrom || [];

    if (dmPolicy === 'allowlist') {
      const normalizedAllowFrom = normalizeAllowFrom(allowFrom);
      const isAllowed = isSenderAllowed({ allow: normalizedAllowFrom, senderId });

      if (!isAllowed) {
        log?.debug?.(`[RocketChat] DM blocked: senderId=${senderId} not in allowlist (dmPolicy=allowlist)`);

        // Notify user with their sender ID so they can request access
        try {
          await sendBySession(
            rocketchatConfig,
            sessionWebhook,
            `⛔ Access restricted\n\nYour user ID: \`${senderId}\`\n\nPlease contact administrator to add this ID to the allowlist.`,
            { log }
          );
        } catch (err: any) {
          log?.debug?.(`[RocketChat] Failed to send access denied message: ${err.message}`);
        }

        return;
      }

      log?.debug?.(`[RocketChat] DM authorized: senderId=${senderId} in allowlist`);
    } else if (dmPolicy === 'pairing') {
      // For pairing mode, SDK will handle the authorization
      // Set commandAuthorized to true to let SDK check pairing status
      commandAuthorized = true;
    } else {
      // 'open' policy - allow all
      commandAuthorized = true;
    }
  }

  // For now, we're not handling media files, but we could extend this later
  let mediaPath: string | undefined;
  let mediaType: string | undefined;

  const route = rt.channel.routing.resolveAgentRoute({
    cfg,
    channel: 'rocketchat',
    accountId,
    peer: { kind: isDirect ? 'dm' : 'group', id: isDirect ? senderId : channelId },
  });

  const storePath = rt.channel.session.resolveStorePath(cfg.session?.store, { agentId: route.agentId });
  const envelopeOptions = rt.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const previousTimestamp = rt.channel.session.readSessionUpdatedAt({ storePath, sessionKey: route.sessionKey });

  const fromLabel = isDirect ? `${senderName} (${senderId})` : `${channelName} - ${senderName}`;
  const body = rt.channel.reply.formatInboundEnvelope({
    channel: 'RocketChat',
    from: fromLabel,
    timestamp: data.timestamp,
    body: content.text,
    chatType: isDirect ? 'direct' : 'group',
    sender: { name: senderName, id: senderId },
    previousTimestamp,
    envelope: envelopeOptions,
  });

  const to = isDirect ? senderId : channelId;
  const ctx = rt.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: content.text,
    CommandBody: content.text,
    From: to,
    To: to,
    SessionKey: route.sessionKey,
    AccountId: accountId,
    ChatType: isDirect ? 'direct' : 'group',
    ConversationLabel: fromLabel,
    GroupSubject: isDirect ? undefined : channelName,
    SenderName: senderName,
    SenderId: senderId,
    Provider: 'rocketchat',
    Surface: 'rocketchat',
    MessageSid: data.message_id,
    Timestamp: data.timestamp,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath,
    CommandAuthorized: commandAuthorized,
    OriginatingChannel: 'rocketchat',
    OriginatingTo: to,
  });

  await rt.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctx.SessionKey || route.sessionKey,
    ctx,
    updateLastRoute: { sessionKey: route.mainSessionKey, channel: 'rocketchat', to, accountId },
    onRecordError: (err: unknown) => {
      log?.error?.(`[RocketChat] Failed to record inbound session: ${String(err)}`);
    },
  });

  log?.info?.(`[RocketChat] Inbound: from=${senderName} text="${content.text.slice(0, 50)}..."`);

  // Feedback: Thinking...
  if (rocketchatConfig.showThinking !== false) {
    try {
      const thinkingText = '🤔 Thinking, please wait...';
      await sendMessage(rocketchatConfig, to, thinkingText, {
        sessionWebhook,
        atUserId: !isDirect ? senderId : null,
        log,
        accountId,
      });
    } catch (err: any) {
      log?.debug?.(`[RocketChat] Thinking message failed: ${err.message}`);
    }
  }

  const { queuedFinal } = await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg,
    dispatcherOptions: {
      responsePrefix: '',
      deliver: async (payload: any) => {
        try {
          const textToSend = payload.markdown || payload.text;
          if (!textToSend) return;

          await sendMessage(rocketchatConfig, to, textToSend, {
            sessionWebhook,
            atUserId: !isDirect ? senderId : null,
            log,
            accountId,
          });
        } catch (err: any) {
          log?.error?.(`[RocketChat] Reply failed: ${err.message}`);
          throw err;
        }
      },
    },
  });

  // Cleanup media if necessary
  if (mediaPath) {
    // TODO: Implement media cleanup if needed
  }
}

// Rocket.Chat Channel Definition
export const rocketchatPlugin = {
  id: 'rocketchat',
  meta: {
    id: 'rocketchat',
    label: 'Rocket.Chat',
    selectionLabel: 'Rocket.Chat',
    docsPath: '/channels/rocketchat',
    blurb: 'Rocket.Chat messaging via Webhook mode.',
    aliases: ['rc', 'rocket'],
  },
  configSchema: buildChannelConfigSchema(RocketChatConfigSchema),
  capabilities: {
    chatTypes: ['direct', 'group'],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
    outbound: true,
  },
  reload: { configPrefixes: ['channels.rocketchat'] },
  config: {
    listAccountIds: (cfg: OpenClawConfig): string[] => {
      const config = getConfig(cfg);
      return config.accounts ? Object.keys(config.accounts) : isConfigured(cfg) ? ['default'] : [];
    },
    resolveAccount: (cfg: OpenClawConfig, accountId?: string) => {
      const config = getConfig(cfg);
      const id = accountId || 'default';
      const account = config.accounts?.[id];
      return account
        ? { accountId: id, config: account, enabled: account.enabled !== false }
        : { accountId: 'default', config, enabled: config.enabled !== false };
    },
    defaultAccountId: (): string => 'default',
    isConfigured: (account: any): boolean => Boolean(account.config?.webhookUrl && account.config?.authToken),
    describeAccount: (account: any) => ({
      accountId: account.accountId,
      name: account.config?.name || 'Rocket.Chat',
      enabled: account.enabled,
      configured: Boolean(account.config?.webhookUrl),
    }),
  },
  security: {
    resolveDmPolicy: ({ account }: any) => ({
      policy: account.config?.dmPolicy || 'open',
      allowFrom: account.config?.allowFrom || [],
      policyPath: 'channels.rocketchat.dmPolicy',
      allowFromPath: 'channels.rocketchat.allowFrom',
      approveHint: 'Use /allow rocketchat:<userId> to approve user',
      normalizeEntry: (raw: string) => raw.replace(/^(rocketchat|rc|rocket):/i, ''),
    }),
  },
  groups: {
    resolveRequireMention: ({ cfg }: any): boolean => getConfig(cfg).groupPolicy !== 'open',
  },
  messaging: {
    normalizeTarget: ({ target }: any) => (target ? { targetId: target.replace(/^(rocketchat|rc|rocket):/i, '') } : null),
    targetResolver: { looksLikeId: (id: string): boolean => /^[\w-]+$/.test(id), hint: '<conversationId>' },
  },
  outbound: {
    deliveryMode: 'direct',
    resolveTarget: ({ to }: any) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error('Rocket.Chat message requires --to <conversationId>'),
        };
      }
      return { ok: true, to: trimmed };
    },
    sendText: async ({ cfg, to, text, accountId, log }: any) => {
      const config = getConfig(cfg, accountId);
      try {
        const result = await sendMessage(config, to, text, { log, accountId });
        getLogger()?.debug?.(`[RocketChat] sendText: "${text}" result: ${JSON.stringify(result)}`);
        return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
      } catch (err: any) {
        return { ok: false, error: err.response?.data || err.message };
      }
    },
    sendMedia: async ({ cfg, to, mediaPath, accountId, log }: any) => {
      const config = getConfig(cfg, accountId);
      if (!config.webhookUrl) {
        return { ok: false, error: 'Rocket.Chat not configured' };
      }
      try {
        const mediaDescription = `[Media message (not supported yet): ${mediaPath}]`;
        const result = await sendMessage(config, to, mediaDescription, { log, accountId });
        getLogger()?.debug?.(`[RocketChat] sendMedia: "${mediaDescription}" result: ${JSON.stringify(result)}`);
        return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
      } catch (err: any) {
        return { ok: false, error: err.response?.data || err.message };
      }
    },
  },
  gateway: {
    startAccount: async (ctx: GatewayStartContext): Promise<GatewayStopResult> => {
      const { account, cfg, abortSignal } = ctx;
      const config = account.config;
      if (!config.authToken) throw new Error('Rocket.Chat authToken is required');

      if (ctx.log?.info) {
        ctx.log.info(`[${account.accountId}] Starting Rocket.Chat webhook listener...`);
      }

      cleanupOrphanedTempFiles(ctx.log);

      // Register webhook endpoint with OpenClaw's HTTP router
      // Using dynamic imports to access internal modules
      try {
        // Dynamically import the registration function from OpenClaw's plugin system
        const httpModules = await Promise.all([
          import('/home/zick/.npm-global/lib/node_modules/openclaw/dist/plugins/http-registry.js'),
          import('/home/zick/.npm-global/lib/node_modules/openclaw/dist/plugins/http-path.js')
        ]);
        
        const { registerPluginHttpRoute } = httpModules[0];
        const { normalizePluginHttpPath } = httpModules[1];
        
        // Define the webhook paths - use the actual token as part of the path
        // This matches the format that Rocket.Chat uses: /hooks/{token}
        const configuredAuthToken = config.authToken;
        const webhookPath = `/hooks/${configuredAuthToken}`;
        const normalizedPath = normalizePluginHttpPath(webhookPath, `/hooks/rocketchat`);
        
        // Register the main webhook handler
        const unregisterWebhook = registerPluginHttpRoute({
          path: normalizedPath,
          pluginId: 'rocketchat',
          accountId: account.accountId,
          log: (msg: string) => ctx.log?.debug?.(msg),
          handler: async (req: any, res: any) => {
            // Handle GET requests for verification
            if (req.method === 'GET') {
              ctx.log?.debug?.('[RocketChat] Received GET request for verification');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'text/plain');
              res.end('Rocket.Chat webhook is active');
              return;
            }
            
            // Only accept POST requests
            if (req.method !== 'POST') {
              ctx.log?.debug?.('[RocketChat] Method not allowed');
              res.statusCode = 405;
              res.setHeader('Allow', 'GET, POST');
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Method Not Allowed' }));
              return;
            }
            
            try {
              // Read request body
              let body = '';
              req.on('data', (chunk: Buffer) => {
                body += chunk.toString();
              });
              
              req.on('end', async () => {
                try {
                  // Sometimes Rocket.Chat might send form-encoded data, not JSON
                  let parsedBody: any;
                  
                  // Check content-type header to determine how to parse
                  const contentType = req.headers['content-type'] || '';
                  
                  if (contentType.includes('application/json')) {
                    parsedBody = JSON.parse(body);
                  } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    // Parse form data
                    const formData = new URLSearchParams(body);
                    parsedBody = Object.fromEntries(formData.entries());
                    
                    // If the form data contains a payload field, it might be JSON inside
                    if (parsedBody.payload) {
                      parsedBody = JSON.parse(parsedBody.payload);
                    }
                  } else {
                    // Assume it's JSON but warn
                    try {
                      parsedBody = JSON.parse(body);
                    } catch {
                      // If it's not valid JSON, try to treat as form data
                      const formData = new URLSearchParams(body);
                      parsedBody = Object.fromEntries(formData.entries());
                      
                      if (parsedBody.payload) {
                        parsedBody = JSON.parse(parsedBody.payload);
                      }
                    }
                  }
                  
                  // Verify the token - check both body.token and potentially other locations
                  if (parsedBody.token !== config.authToken) {
                    ctx.log?.error?.(`[RocketChat] Unauthorized webhook request - token mismatch`);
                    res.statusCode = 401;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Unauthorized: Invalid token' }));
                    return;
                  }
                  
                  // Validate required fields from Rocket.Chat data structure
                  if (!parsedBody.user_id || !parsedBody.text) {
                    ctx.log?.error?.(`[RocketChat] Missing required fields in webhook request`);
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Bad Request: Missing required fields' }));
                    return;
                  }
                  
                  // For immediate response, we'll prepare to handle the response asynchronously
                  // but still respond quickly to avoid timeouts
                  
                  // Process the message asynchronously and send response via the OpenClaw reply system
                  // For now, immediately respond with 200 to avoid timeout
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ 
                    text: '', // Initially return empty response
                    response_type: 'ephemeral' // Only visible to the sender
                  }));

                  // Process the message asynchronously after responding to prevent timeouts
                  setTimeout(async () => {
                    try {
                      // Process the message through the standard OpenClaw pipeline
                      // Use a placeholder for protocol and host since those properties might not be available on raw http req
                      const sessionWebhookForProcessing = `https://${req.headers.host || 'localhost'}${req.url}`;
                      
                      // Import the handleRocketChatMessage function directly from the channel module
                      const channelModule = await import('./channel');
                      const handleMsgFunc = channelModule.handleRocketChatMessage || (await import('./webhook-handler')).handleRocketChatMessage;
                      
                      await handleMsgFunc({
                        cfg,
                        accountId: account.accountId,
                        data: parsedBody,
                        sessionWebhook: sessionWebhookForProcessing,
                        log: ctx.log || console,
                        rocketchatConfig: config
                      });
                    } catch (processingError: any) {
                      ctx.log?.error?.(`[RocketChat] Error processing message after response: ${processingError.message}`);
                    }
                  }, 0);
                  
                } catch (parseError: any) {
                  ctx.log?.error?.(`[RocketChat] Error parsing request: ${parseError.message}`);
                  ctx.log?.error?.(`[RocketChat] Raw body: ${body}`);
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Bad Request: Invalid JSON' }));
                }
              });
              
            } catch (error: any) {
              ctx.log?.error?.(`[RocketChat] Error processing webhook: ${error.message}`);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Internal Server Error' }));
            }
          },
        });

        // Register health check endpoint
        const healthPath = `/hooks/rocketchat/${account.accountId}/health`;
        const normalizedHealthPath = normalizePluginHttpPath(healthPath, `/hooks/rocketchat/health`);
        const unregisterHealth = registerPluginHttpRoute({
          path: normalizedHealthPath,
          pluginId: 'rocketchat',
          accountId: account.accountId,
          log: (msg: string) => ctx.log?.debug?.(msg),
          handler: (req: any, res: any) => {
            if (req.method !== 'GET') {
              res.statusCode = 405;
              res.setHeader('Allow', 'GET');
              res.end('Method Not Allowed');
              return;
            }
            
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ 
              status: 'ok', 
              service: 'Rocket.Chat webhook handler',
              timestamp: new Date().toISOString()
            }));
          },
        });

        // Store unregister functions to clean up when stopping
        (globalThis as any).__rocketchat_unregister_functions = (globalThis as any).__rocketchat_unregister_functions || {};
        (globalThis as any).__rocketchat_unregister_functions[account.accountId] = () => {
          try {
            unregisterWebhook();
            unregisterHealth();
          } catch (unregErr: any) {
            ctx.log?.error?.(`[${account.accountId}] Error unregistering endpoints: ${unregErr.message}`);
          }
        };

        if (ctx.log?.info) {
          ctx.log.info(`[${account.accountId}] Rocket.Chat webhook listener ready at ${normalizedPath}`);
        }

      } catch (error: any) {
        ctx.log?.error?.(`[${account.accountId}] Failed to register webhook endpoints: ${error.message}`);
        // Don't throw the error, just log it, so the service can still start
      }

      let stopped = false;
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          if (stopped) return;
          stopped = true;
          if (ctx.log?.info) {
            ctx.log.info(`[${account.accountId}] Stopping Rocket.Chat webhook listener...`);
          }
          
          // Unregister the HTTP endpoints
          try {
            const unregisterFunctions = (globalThis as any).__rocketchat_unregister_functions;
            if (unregisterFunctions && unregisterFunctions[account.accountId]) {
              unregisterFunctions[account.accountId]();
              delete unregisterFunctions[account.accountId];
            }
          } catch (unregErr: any) {
            ctx.log?.error?.(`[${account.accountId}] Error unregistering endpoints: ${unregErr.message}`);
          }
        });
      }

      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          if (ctx.log?.info) {
            ctx.log.info(`[${account.accountId}] Rocket.Chat provider stopped`);
          }
        },
      };
    },
  },
  status: {
    defaultRuntime: { accountId: 'default', running: false, lastStartAt: null, lastStopAt: null, lastError: null },
    probe: async ({ cfg }: any) => {
      if (!isConfigured(cfg)) return { ok: false, error: 'Not configured' };
      try {
        const config = getConfig(cfg);
        // Simple test to verify the configuration
        return { ok: true, details: { webhookUrl: config.webhookUrl } };
      } catch (error: any) {
        return { ok: false, error: error.message };
      }
    },
    buildChannelSummary: ({ snapshot }: any) => ({
      configured: snapshot?.configured ?? false,
      running: snapshot?.running ?? false,
      lastStartAt: snapshot?.lastStartAt ?? null,
      lastStopAt: snapshot?.lastStopAt ?? null,
      lastError: snapshot?.lastError ?? null,
    }),
  },
};

/**
 * Public low-level API exports for the Rocket.Chat channel plugin.
 *
 * - {@link sendBySession} sends a message to Rocket.Chat using a session/webhook
 *   (e.g. replies within an existing conversation).
 * - {@link sendMessage} sends a message with automatic mode selection
 *   (text/markdown based on config).
 * - {@link getLogger} retrieves the current global logger instance
 *   (set by handleRocketChatMessage during inbound message processing).
 * - {@link handleRocketChatMessage} processes inbound messages from Rocket.Chat.
 *
 * These exports are intended to be used by external integrations that need
 * direct programmatic access to Rocket.Chat messaging.
 */
export { sendBySession, sendMessage, getLogger, handleRocketChatMessage };