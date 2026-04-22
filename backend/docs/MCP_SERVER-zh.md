# MCP（Model Context Protocol）配置

DeerFlow 支持可配置的 MCP 服务器与技能以扩展能力，相关配置从项目根目录下的专用文件 `extensions_config.json` 加载。

## 设置

1. 将 `extensions_config.example.json` 复制到项目根目录下的 `extensions_config.json`。
   ```bash
   # Copy example configuration
   cp extensions_config.example.json extensions_config.json
   ```
   
2. 将需要的 MCP 服务器或技能的 `"enabled"` 设为 `true`。
3. 按需配置每个服务器的命令、参数与环境变量。
4. 重启应用以加载并注册 MCP 工具。

## OAuth 支持（HTTP/SSE MCP 服务器）

对于 `http` 与 `sse` 类型的 MCP 服务器，DeerFlow 支持 OAuth 获取令牌并自动刷新。

- 支持的授权类型：`client_credentials`、`refresh_token`
- 在 `extensions_config.json` 中为每个服务器配置 `oauth` 块
- 密钥应通过环境变量提供（例如：`$MCP_OAUTH_CLIENT_SECRET`）

示例：

```json
{
   "mcpServers": {
      "secure-http-server": {
         "enabled": true,
         "type": "http",
         "url": "https://api.example.com/mcp",
         "oauth": {
            "enabled": true,
            "token_url": "https://auth.example.com/oauth/token",
            "grant_type": "client_credentials",
            "client_id": "$MCP_OAUTH_CLIENT_ID",
            "client_secret": "$MCP_OAUTH_CLIENT_SECRET",
            "scope": "mcp.read",
            "refresh_skew_seconds": 60
         }
      }
   }
}
```

## 工作原理

MCP 服务器暴露的工具会在运行时被自动发现并集成到 DeerFlow 的 agent 系统中。启用后，这些工具即可供 agent 使用，无需额外改代码。

## 能力示例

MCP 服务器可提供：

- **文件系统**
- **数据库**（例如 PostgreSQL）
- **外部 API**（例如 GitHub、Brave Search）
- **浏览器自动化**（例如 Puppeteer）
- **自定义 MCP 服务器实现**

## 延伸阅读

关于 Model Context Protocol 的详细文档，请参阅：  
https://modelcontextprotocol.io
