import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { rocketchatPlugin } from './src/channel';
import { setRocketChatRuntime } from './src/runtime';

const plugin = {
  id: 'rocketchat',
  name: 'Rocket.Chat Channel',
  description: 'Rocket.Chat messaging channel via Webhook mode',
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    setRocketChatRuntime(api.runtime);
    api.registerChannel({ plugin: rocketchatPlugin });
  },
};

export default plugin;