# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/vidalytics/vidalytics-mcp/security/advisories/new)
(repository **Security** tab → **Report a vulnerability**). This keeps the
details confidential until a fix is available.

When reporting, please include:

- A description of the issue and its potential impact
- Steps to reproduce (or a proof of concept)
- The package version and your environment (OS, Node.js version, MCP client)

We will acknowledge your report, investigate, and keep you updated on the fix
and disclosure timeline.

## Supported Versions

Only the latest version published to npm is supported. Please make sure you are
on the latest release before reporting an issue.

## Scope

This package is an **installer**: it detects local MCP clients and writes a
`mcp-remote` entry into their configuration files. It does not run a server,
make network requests on its own, or handle credentials — OAuth and all network
activity are handled at runtime by [`mcp-remote`](https://www.npmjs.com/package/mcp-remote)
and the Vidalytics API. Issues in those components should be reported to their
respective projects.
