// Compatibility alias retained for code that imported the first implementation
// wave by its ChatGPT-specific name. New code must import the neutral remote MCP
// connector route so Claude and other approved MCP clients share one contract.
export {
  buildRemoteMcpConnectorRoutes as buildChatGptMcpRoutes,
} from "./remoteMcpConnectorRoutes.js";
