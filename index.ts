import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { kookPlugin } from "./src/channel.js";
import { setKookRuntime } from "./src/runtime.js";

const plugin = {
  id: "kook",
  name: "KOOK",
  description: "KOOK channel plugin for Chinese gaming communities",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setKookRuntime(api.runtime);
    api.registerChannel({ plugin: kookPlugin });
  },
};

export default plugin;
