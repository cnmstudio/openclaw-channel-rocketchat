import type { OpenClawConfig } from 'openclaw/plugin-sdk';
import type { 
  RocketChatConfig, 
  RocketChatInboundMessage, 
  Logger 
} from './types';
import { handleRocketChatMessage } from './channel';
import { getRocketChatRuntime } from './runtime';

// Re-export handleRocketChatMessage to ensure it's accessible from dynamic imports
export { handleRocketChatMessage };

/**
 * Handler for Rocket.Chat webhook requests
 * This function processes incoming webhook requests from Rocket.Chat
 */
export async function rocketChatWebhookHandler(
  req: any, // Express-like request object
  res: any, // Express-like response object
  cfg: OpenClawConfig,
  accountId: string,
  rocketchatConfig: RocketChatConfig,
  log?: Logger
): Promise<void> {
  try {
    // Log the incoming request
    log?.debug?.('[RocketChat] Incoming webhook request:', {
      method: req.method,
      headers: req.headers,
      body: req.body
    });

    // Verify the request is from Rocket.Chat by checking the auth token
    const requestBody = req.body as Partial<RocketChatInboundMessage>;
    
    // Check if the token in the request matches our configured token
    if (requestBody.token !== rocketchatConfig.authToken) {
      log?.error?.(`[RocketChat] Unauthorized webhook request - token mismatch`);
      if (res.status && res.json) {
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
      } else {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid token' }));
      }
      return;
    }

    // Validate required fields
    if (!requestBody.token || !requestBody.user_id || !requestBody.text) {
      log?.error?.(`[RocketChat] Missing required fields in webhook request`);
      if (res.status && res.json) {
        res.status(400).json({ error: 'Bad Request: Missing required fields' });
      } else {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Bad Request: Missing required fields' }));
      }
      return;
    }

    // Cast the request body to our expected format
    const inboundMessage = requestBody as RocketChatInboundMessage;

    // Create a mock session webhook URL (this would typically come from Rocket.Chat)
    // In a real scenario, this might be constructed from the original hook URL
    const sessionWebhook = `${req.protocol || 'https'}://${req.headers?.host || 'localhost'}${req.url || '/hooks/rocketchat'}`;

    // Process the message through the standard OpenClaw pipeline
    await handleRocketChatMessage({
      cfg,
      accountId,
      data: inboundMessage,
      sessionWebhook,
      log: log || console,
      rocketchatConfig
    });

    // Respond to Rocket.Chat that the message was received
    if (res.status && res.json) {
      res.status(200).json({ 
        text: '', // Empty text means no response to send back to the channel
        response_type: 'ephemeral' // Only visible to the sender
      });
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ 
        text: '', // Empty text means no response to send back to the channel
        response_type: 'ephemeral' // Only visible to the sender
      }));
    }

  } catch (error: any) {
    log?.error?.(`[RocketChat] Error processing webhook: ${error.message}`, error.stack);
    if (res.status && res.json) {
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }
}

/**
 * Alternative handler for when Rocket.Chat expects a specific response format
 */
export async function rocketChatInteractiveHandler(
  req: Request,
  res: Response,
  cfg: OpenClawConfig,
  accountId: string,
  rocketchatConfig: RocketChatConfig,
  log?: Logger
): Promise<void> {
  try {
    log?.debug?.('[RocketChat] Processing interactive message request');

    const requestBody = req.body as Partial<RocketChatInboundMessage>;
    
    // Verify the request
    if (requestBody.token !== rocketchatConfig.authToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Validate the message
    if (!requestBody.user_id || !requestBody.text) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Process the message
    const inboundMessage = requestBody as RocketChatInboundMessage;
    const sessionWebhook = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    await handleRocketChatMessage({
      cfg,
      accountId,
      data: inboundMessage,
      sessionWebhook,
      log: log || console,
      rocketchatConfig
    });

    // For interactive messages, we might want to return a response
    // This is configurable based on the use case
    res.status(200).json({
      text: '', // Return empty to not post a public response
      ephemeral: true // This makes the response only visible to the sender
    });

  } catch (error: any) {
    log?.error?.(`[RocketChat] Error in interactive handler: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * Health check endpoint for the Rocket.Chat webhook
 */
export function rocketChatHealthCheck(req: Request, res: Response): void {
  res.status(200).json({ 
    status: 'ok', 
    service: 'Rocket.Chat webhook handler',
    timestamp: new Date().toISOString()
  });
}