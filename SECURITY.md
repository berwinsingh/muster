# Security Policy

## Reporting a vulnerability

Please don't open a public issue.

Use GitHub's private reporting instead — **Security → Report a
vulnerability** on this repository. That opens a private thread visible only
to the maintainers.

Useful things to include: what an attacker could do, the steps to reproduce
it, and the version or commit you were on.

You'll get an acknowledgement within a few days. This is a small project
maintained by one person, so please allow reasonable time for a fix before
disclosing publicly.

## Supported versions

Fixes land on `main` and go out in the next release. There are no long-term
support branches.

## What's in scope

Muster runs commands from your own configuration and holds their output, so
the areas most worth scrutiny:

- **Command execution.** Muster runs what `.vscode/muster.json` defines. A
  path where something *other* than the configured command executes — via
  crafted config, service ids, or `${...}` substitution — is a real
  vulnerability.
- **The IPC endpoint.** The daemon and the extension listen on
  `127.0.0.1` and write a discovery file under `~/.config/muster/ipc/`.
  Anything letting a non-local or unintended process drive lifecycle
  actions through it is in scope.
- **Agent actions.** MCP lifecycle calls are meant to be gated — a
  confirmation prompt in the editor, or an explicit
  `--allow-agent-actions` on the daemon. A way to start or stop processes
  that bypasses that gate is in scope.
- **Log storage.** Logs are written under `~/.muster/logs/`. Path traversal
  out of that directory, or logs written with unexpectedly loose
  permissions, is in scope.

## What's not

- Muster running a command you configured, as configured. That's the
  feature. Config is code — treat `.vscode/muster.json` from an untrusted
  repository exactly as you'd treat its `package.json` scripts.
- Secrets appearing in captured output. Muster records what your services
  print. Anything a service writes to stdout will land in the log files.
