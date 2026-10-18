import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type AgyQuotaBucket = {
    id: string;
    name: string;
    group: string;
    window: string;
    remainingFraction?: number;
    resetTime?: string;
};

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("AGY returned an invalid response.");
    }
    return value as Record<string, unknown>;
}

function text(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new Error("AGY returned an invalid quota bucket.");
    return value;
}

function commandData(value: unknown, names: string[]): Record<string, unknown> {
    const response = object(value);
    const command = object(response.command);
    if (response.status !== "SUCCESS" || response.num_turns !== 0 || !names.includes(String(command.name))) {
        throw new Error("AGY did not return the requested quota command.");
    }
    return object(command.data);
}

export function parseAgyUsage(value: unknown): AgyQuotaBucket[] {
    const data = commandData(value, ["usage", "quota"]);
    if (!Array.isArray(data.groups)) throw new Error("AGY returned no quota groups.");
    const buckets: AgyQuotaBucket[] = [];
    const ids = new Set<string>();
    for (const item of data.groups) {
        const group = object(item);
        const groupName = text(group.name);
        if (!Array.isArray(group.buckets)) throw new Error("AGY returned invalid quota groups.");
        for (const entry of group.buckets) {
            const bucket = object(entry);
            const id = text(bucket.id);
            if (ids.has(id)) throw new Error("AGY returned duplicate quota buckets.");
            ids.add(id);
            let remainingFraction: number | undefined;
            if (bucket.disabled !== undefined && typeof bucket.disabled !== "boolean") throw new Error("AGY returned an invalid quota state.");
            if (!bucket.disabled && bucket.remaining_fraction !== undefined && bucket.remaining_fraction !== null) {
                const fraction = bucket.remaining_fraction;
                if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
                    throw new Error("AGY returned an invalid quota fraction.");
                }
                remainingFraction = fraction;
            }
            const resetTime = typeof bucket.reset_time === "string" && Number.isFinite(Date.parse(bucket.reset_time))
                ? bucket.reset_time : undefined;
            buckets.push({ id, name: text(bucket.name), group: groupName, window: text(bucket.window), remainingFraction, resetTime });
        }
    }
    return buckets;
}

export function parseAgyCredits(value: unknown): number {
    const credits = commandData(value, ["credits"]).remaining_credits;
    if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0) throw new Error("AGY returned an invalid credit balance.");
    return credits;
}

function runCommand(command: "usage" | "credits"): Promise<unknown> {
    let executable = process.platform === "win32" ? "agy.exe" : "agy";
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
        const installed = join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe");
        if (existsSync(installed)) executable = installed;
    }
    return new Promise((resolve, reject) => {
        const child = execFile(executable, ["-p", `/${command}`, "--output-format", "json", "--print-timeout", "20s"], {
            windowsHide: true,
            timeout: 30000,
            cwd: tmpdir(),
            env: { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: "true" }
        }, (error, stdout) => {
            if (error) {
                // Child diagnostics can contain account details, so do not forward them.
                reject(new Error((error as NodeJS.ErrnoException).code === "ENOENT"
                    ? "AGY is not installed or is not on PATH."
                    : "AGY query failed. Check AGY sign-in and connectivity."));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(new Error("AGY returned invalid JSON."));
            }
        });
        child.stdin?.end();
    });
}

function sharedQuery<T>(command: "usage" | "credits", parse: (value: unknown) => T): (force?: boolean) => Promise<T> {
    let pending: Promise<T> | undefined;
    let snapshot: { value: T; time: number } | undefined;
    return (force = false) => {
        if (pending) return pending;
        if (!force && snapshot && Date.now() - snapshot.time < 5000) return Promise.resolve(snapshot.value);
        pending = runCommand(command).then(parse).then(value => {
            snapshot = { value, time: Date.now() };
            return value;
        }).finally(() => { pending = undefined; });
        return pending;
    };
}

export const getAgyBuckets = sharedQuery("usage", parseAgyUsage);
export const getAgyCredits = sharedQuery("credits", parseAgyCredits);
