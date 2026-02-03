import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Logger } from './src/types';

// Mask sensitive data in logs
export function maskSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const masked = { ...obj };
  const sensitiveKeys = ['token', 'authToken', 'password', 'secret', 'key'];

  for (const [key, value] of Object.entries(masked)) {
    if (sensitiveKeys.some(sk => sk.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(sk.toLowerCase()))) {
      masked[key] = '[MASKED]';
    } else if (typeof value === 'object') {
      masked[key] = maskSensitiveData(value);
    }
  }

  return masked;
}

// Clean up orphaned temporary files
export function cleanupOrphanedTempFiles(log?: Logger): void {
  try {
    const tempDir = os.tmpdir();
    const files = fs.readdirSync(tempDir);
    
    for (const file of files) {
      if (file.startsWith('rocketchat_')) {
        const filePath = path.join(tempDir, file);
        const stat = fs.statSync(filePath);
        
        // Delete files older than 1 hour
        if (Date.now() - stat.mtimeMs > 3600000) {
          fs.unlinkSync(filePath);
          log?.debug?.(`[RocketChat] Cleaned up orphaned temp file: ${filePath}`);
        }
      }
    }
  } catch (err: any) {
    log?.error?.(`[RocketChat] Error cleaning up temp files: ${err.message}`);
  }
}

// Retry with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delayMs?: number; log?: Logger } = {}
): Promise<T> {
  const { maxRetries = 3, delayMs = 1000, log } = options;
  let lastError: any;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        const delay = delayMs * Math.pow(2, i); // Exponential backoff
        log?.debug?.(`[RocketChat] Retry attempt ${i + 1}/${maxRetries + 1} failed, waiting ${delay}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Sanitize text for Rocket.Chat
export function sanitizeText(text: string): string {
  // Replace problematic characters or patterns for Rocket.Chat
  return text
    .replace(/\u00A0/g, ' ') // Non-breaking space to regular space
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .substring(0, 4000);     // Truncate to reasonable length (adjust as needed)
}

// Format message for Rocket.Chat
export function formatMessage(text: string, options: { markdown?: boolean } = {}): string {
  if (options.markdown === false) {
    // Escape markdown characters if not using markdown
    return text
      .replace(/([*_~`])/g, '\\$1')
      .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)'); // Convert links to plain text
  }
  return text;
}