# Quality rules (Discord MCP)

- Must call `discord.send_message` once
- Required args must be present
- JSON schema must validate
- If status is ok, include 1-3 findings
- next_action must be one of: send_reminder, done, retry
