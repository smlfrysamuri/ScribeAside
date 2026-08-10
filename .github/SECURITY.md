# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ScribeAside, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainer directly or use [GitHub's private vulnerability reporting](https://github.com/smlfrysamuri/ScribeAside/security/advisories/new).

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

ScribeAside runs as a VS Code extension with webview content. The main security concerns are:

- **Content Security Policy (CSP)** — the webview uses nonce-based CSP to prevent script injection
- **Storage** — notes are stored in VS Code's `workspaceState` and `globalState`, not on disk
- **External links** — only `http://` and `https://` URLs are opened externally; file paths open in the editor
