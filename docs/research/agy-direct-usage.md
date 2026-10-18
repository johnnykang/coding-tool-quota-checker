# Direct AGY usage research

Research date: 18 October 2026.

## Recommendation

Replace the external statusline cache with a short-lived call to the installed AGY executable:

```powershell
agy -p /usage --output-format json
```

Google added this interface in 1.1.11. It returns quota data without an agent turn, model quota consumption, or a conversation. [Official changelog](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md#1111)

The `/usage` command refreshes quota status from the backend. The plugin therefore does not need the removed JavaScript hook or its output file. AGY still manages its own credentials and internal state. [Official usage documentation](https://antigravity.google/docs/cli/commands/usage/)

## Local evidence

The research session successfully queried the installed AGY 1.4.2 executable under the normal Windows account on 18 October 2026. The `/usage` process exited with code 0. Total command time was approximately 8.6 seconds. The sandbox probe failed to access the cached credentials and attempted OAuth authentication. The same query succeeded outside the sandbox with Windows credential access. The deployed plugin does not require administrator privileges.

The response contained `command.name` and `command.data.groups[].buckets[]`. Each group contained `name`, `description`, and `buckets`. The account returned these buckets:

| Group | Bucket ID | Window |
|---|---|---|
| Gemini | `gemini-weekly` | `weekly` |
| Gemini | `gemini-5h` | `5h` |
| Claude and GPT | `3p-weekly` | `weekly` |
| Claude and GPT | `3p-5h` | `5h` |
| Gemini 4 Argon | `gemini-argon-wtu-weekly` | `weekly` |

Two fixed model groups do not cover the current account. Gemini 4 Argon has a separate weekly bucket. A weekly-only group does not imply a missing five-hour measurement.

Each observed bucket contained `id`, `name`, `window`, `remaining_fraction`, and `reset_time`. Reset times used ISO timestamps in UTC. A fraction of `0.9536665` represents approximately 95.4% remaining, or 4.6% used. Displayed percentages must preserve that distinction.

A separate Node.js `execFile` probe also succeeded with `status: SUCCESS`, `num_turns: 0`, and all token counters at zero. It took approximately 7.0 seconds. The probe used the actual `.exe`, closed stdin, and ran from the temporary directory with these options:

```typescript
const args = ['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s'];
const options = { windowsHide: true, timeout: 30000, cwd: tmpdir() };
```

This verifies the subprocess mechanism under the normal Windows account. It does not verify execution inside Stream Deck itself.

## Response contract and limits

Google documents the general JSON envelope but does not publish the quota bucket schema in the pages reviewed. A request for a stable documented quota schema remains on the official issue tracker. Its author reports the same `command.data.groups[].buckets[]` structure. [Headless documentation](https://antigravity.google/docs/cli/headless), [schema request](https://github.com/google-antigravity/antigravity-cli/issues/1045)

An independent TypeScript consumer implements the exact command and validates `status: SUCCESS`, `num_turns: 0`, and `command.name: usage` or `quota`. Its parser reads the quota fractions from `command.data`, rather than the root `usage` token counters. This is primary evidence for that consumer, not a Google schema guarantee. [Consumer implementation](https://github.com/lefos13/paseo-plugin-antigravity-cli/blob/main/server/quota.ts#L149)

A second consumer defines optional `disabled` and `remaining_amount` fields. These fields did not appear in the successful local buckets. Google separately documents the disabled quota state in its changelog. A disabled or absent fraction must produce an unavailable state, not zero or 100%. [Consumer DTOs](https://pkg.go.dev/github.com/maruel/genai/providers/antigravity#UsageBucket), [official changelog](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md)

## Windows integration proposal

Use Node.js `execFile` against the installed `.exe`, with an argument array, `shell: false`, and `windowsHide: true`. The local executable resolves under `%LOCALAPPDATA%\agy\bin\agy.exe`. Resolve this path explicitly because Stream Deck does not necessarily inherit the terminal's `PATH`.

Keep the user's normal sign-in and environment, except for the updater setting below. AGY reads its cached credentials. Its headless output separates JSON on stdout from diagnostics on stderr. No plugin token field or credential extraction is necessary. [Official headless documentation](https://antigravity.google/docs/cli/headless)

Google documents an authentication error for unauthenticated headless runs without a terminal. The Windows sandbox probe instead attempted OAuth authentication. Close the child's stdin and enforce the parent timeout. Signed-out behaviour under Stream Deck remains unverified.

Set `AGY_CLI_DISABLE_AUTO_UPDATE=true` only in the child process environment. Preserve the other environment variables and leave global settings unchanged. AGY has a background self-updater with a 15-minute debounce. This override prevents quota polling from updating the installed CLI. [Official troubleshooting documentation](https://antigravity.google/docs/cli/troubleshooting#resolve-self-updater-locks-and-failures)

Use one shared in-flight query for all AGY buttons. Let each button select a returned bucket by ID. The existing five-minute interval is a reasonable initial polling choice. This interval is a design proposal, not a documented Google rate limit. A short in-memory result can serve buttons together without an external cache file.

Apply a bounded subprocess timeout and handle authentication, network, malformed JSON, and missing selected buckets separately. The successful probe does not establish a safe timeout ceiling. Keep the argument list fixed. Do not pass `--disable-slash-commands`, a conversation ID, or an ordinary language prompt. Google requires a standalone invocation for `/usage`, rather than stream input. [Official headless documentation](https://antigravity.google/docs/cli/headless)

## Credits and alternative interfaces

The local `/credits` query also succeeded with code 0 and zero turns. It returned `command.name: credits` and data with `remaining_credits` and `upgrade_uri`. Total command time was approximately 7.3 seconds. The account's reported balance was zero. A credits balance is separate from subscription quota and needs a separate display choice. [Official credits documentation](https://antigravity.google/docs/cli/commands/credits/)

The reviewed official sources provide a working CLI interface, but no supported public subscription quota endpoint or stable ACP quota method. An issue author identifies an internal `v1internal:retrieveUserQuotaSummary` call. That report does not establish a supported API contract. Direct HTTP or internal RPC integration adds authentication and compatibility work without a benefit for this plugin. [Official tracker discussion](https://github.com/google-antigravity/antigravity-cli/issues/1045)

No plugin implementation changed. Runtime verification covers one Windows account and AGY 1.4.2. Other plans, disabled buckets, expired credentials, and future response formats remain unverified.
