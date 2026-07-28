import { createAuthProxyHandler } from "./proxy.mjs";

const handleRequest = createAuthProxyHandler();

export default {
  async fetch(request) {
    return handleRequest(request);
  },
};
