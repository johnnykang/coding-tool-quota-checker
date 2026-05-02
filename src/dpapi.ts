import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** Prefix used to identify DPAPI-encrypted values in global settings. */
const DPAPI_PREFIX = "dpapi:";

export function isDpapiEncrypted(value: string): boolean {
    return value.startsWith(DPAPI_PREFIX);
}

/**
 * Encrypts a plaintext string with Windows DPAPI via PowerShell.
 * The result is bound to the current user account and machine.
 * Throws on non-Windows platforms.
 */
export async function encryptDpapi(plaintext: string): Promise<string> {
    // Escape single quotes for PowerShell string literals.
    const escaped = plaintext.replace(/'/g, "''");
    const cmd =
        `powershell -NoProfile -NonInteractive -Command ` +
        `"$s=ConvertTo-SecureString '${escaped}' -AsPlainText -Force; ` +
        `ConvertFrom-SecureString $s"`;
    const { stdout } = await execAsync(cmd, { timeout: 8000 });
    return DPAPI_PREFIX + stdout.trim();
}

/**
 * Decrypts a DPAPI ciphertext produced by encryptDpapi.
 * Throws if the value is not a recognised ciphertext or decryption fails.
 */
export async function decryptDpapi(ciphertext: string): Promise<string> {
    if (!isDpapiEncrypted(ciphertext)) {
        throw new Error("Value is not a DPAPI ciphertext");
    }
    const hex = ciphertext.slice(DPAPI_PREFIX.length);
    const cmd =
        `powershell -NoProfile -NonInteractive -Command ` +
        `"(New-Object System.Net.NetworkCredential('', ` +
        `(ConvertTo-SecureString '${hex}'))).Password"`;
    const { stdout } = await execAsync(cmd, { timeout: 8000 });
    return stdout.trim();
}

/**
 * Resolves a stored secret to its plaintext value.
 *
 * - **Windows**: the stored value must be DPAPI-encrypted (has `dpapi:` prefix).
 *   If it is not (e.g. a legacy plaintext value from before this change was
 *   deployed), returns `undefined` — the user must re-enter the secret.
 * - **macOS / Linux**: DPAPI is unavailable. Secrets are stored as plaintext
 *   in globalSettings. Returns the value as-is.
 *
 * Returns `undefined` on any decryption failure or missing value.
 */
export async function resolveSecret(value: string | undefined): Promise<string | undefined> {
    if (!value) return undefined;

    if (process.platform === "win32") {
        if (!isDpapiEncrypted(value)) {
            // Plaintext in globalSettings — was saved before DPAPI was introduced.
            // Treat as unset to force re-entry rather than silently using an
            // unencrypted credential.
            return undefined;
        }
        try {
            return await decryptDpapi(value);
        } catch {
            // Decryption failed — machine change, password reset, etc.
            return undefined;
        }
    } else {
        // macOS/Linux: secrets are stored as plaintext. A DPAPI-prefixed value
        // here means the settings were moved from a Windows machine; treat as unset.
        return isDpapiEncrypted(value) ? undefined : value;
    }
}
