import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import * as https from "https";
import { exec } from "child_process";
import { promisify } from "util";
import { generateLoadingSvg, generateMessageSvg, generatePercentageSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";

const execAsync = promisify(exec);

export type AntigravitySettings = {
    modelLabel?: string;
};

// ─── Internal HTTP helpers ────────────────────────────────────────────────────

/**
 * Sends a lightweight probe to the Antigravity language server to confirm the
 * port is accepting requests with the given CSRF token.
 */
async function testPortConnectivity(port: number, csrfToken: string): Promise<boolean> {
    return new Promise((resolve) => {
        const body = JSON.stringify({
            context: { properties: { ide: "antigravity", ideVersion: "1.0.0" } }
        });
        const req = https.request({
            hostname: '127.0.0.1',
            port: port,
            path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Connect-Protocol-Version': '1',
                'X-Codeium-Csrf-Token': csrfToken
            },
            rejectUnauthorized: false,
            timeout: 2000
        }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.write(body);
        req.end();
    });
}

/** Fetches the full user status payload from the language server. */
async function fetchUserStatus(port: number, csrfToken: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            metadata: { ideName: "antigravity", extensionName: "antigravity", ideVersion: "1.0.0", locale: "en" }
        });
        const req = https.request({
            hostname: '127.0.0.1',
            port: port,
            path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Connect-Protocol-Version': '1',
                'X-Codeium-Csrf-Token': csrfToken
            },
            rejectUnauthorized: false,
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error("timeout")); });
        req.write(body);
        req.end();
    });
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class AntigravityProvider implements IQuotaProvider<AntigravitySettings> {
    private readonly diffTracker = new DiffTracker();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) { }

    async check(action: KeyAction<AntigravitySettings>): Promise<void> {
        const settings = await action.getSettings();
        const modelLabel = settings.modelLabel?.toLowerCase().trim();

        try {
            await action.setImage(generateLoadingSvg());
            await action.setTitle("");

            if (process.platform !== "win32") {
                await action.setImage(generateMessageSvg("Win", "Only"));
                return;
            }

            const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='language_server_windows_x64.exe'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
            const { stdout } = await execAsync(cmd, { timeout: 10000 });

            if (!stdout || stdout.trim() === "") {
                await action.setImage(generateMessageSvg("No", "Proc"));
                return;
            }

            let processData;
            try {
                processData = JSON.parse(stdout.trim());
            } catch (e) {
                await action.setImage(generateMessageSvg("Err", "JSON"));
                return;
            }

            let agProcess = null;
            if (Array.isArray(processData)) {
                agProcess = processData.find((p: any) => p.CommandLine && (p.CommandLine.includes("antigravity") || p.CommandLine.includes("--app_data_dir")));
            } else {
                if (processData.CommandLine && (processData.CommandLine.includes("antigravity") || processData.CommandLine.includes("--app_data_dir"))) {
                    agProcess = processData;
                }
            }

            if (!agProcess) {
                await action.setImage(generateMessageSvg("No", "AG"));
                return;
            }

            const pid = agProcess.ProcessId;
            const cmdLine = agProcess.CommandLine;
            const tokenMatch = cmdLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
            if (!tokenMatch) {
                await action.setImage(generateMessageSvg("No", "Token"));
                return;
            }
            const csrfToken = tokenMatch[1];

            const netstatCmd = `netstat -ano | findstr "${pid}" | findstr "LISTENING"`;
            const { stdout: netstatOut } = await execAsync(netstatCmd, { timeout: 5000 });

            const portRegex = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?]):(\d+)\s+\S+\s+LISTENING/gi;
            const ports: number[] = [];
            let match;
            while ((match = portRegex.exec(netstatOut)) !== null) {
                const port = parseInt(match[1], 10);
                if (!ports.includes(port)) ports.push(port);
            }

            if (ports.length === 0) {
                await action.setImage(generateMessageSvg("No", "Ports"));
                return;
            }

            let workingPort: number | null = null;
            for (const port of ports) {
                const isWorking = await testPortConnectivity(port, csrfToken);
                if (isWorking) {
                    workingPort = port;
                    break;
                }
            }

            if (!workingPort) {
                await action.setImage(generateMessageSvg("No", "API"));
                return;
            }

            const response = await fetchUserStatus(workingPort, csrfToken);
            const modelConfigs = response?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];

            const availableModels = modelConfigs.map((c: any) => ({
                label: c.label,
                modelId: c.modelOrAlias?.model
            }));
            streamDeck.logger.info(`Available Antigravity models: ${JSON.stringify(availableModels)}`);

            let targetModel = null;
            if (modelLabel) {
                targetModel = modelConfigs.find((c: any) => c.label && c.label.toLowerCase().includes(modelLabel) && c.quotaInfo);
            }

            if (!targetModel) {
                targetModel = modelConfigs.find((c: any) => c.quotaInfo);
            }

            if (!targetModel || !targetModel.quotaInfo) {
                await action.setImage(generateMessageSvg("No", "Quota"));
                return;
            }

            const remainingFraction = targetModel.quotaInfo.remainingFraction;
            let usagePercentage = remainingFraction !== undefined ? Math.round((1 - remainingFraction) * 100) : 100;

            if (targetModel.quotaInfo.isExhausted) {
                usagePercentage = 100;
            }

            const labelStr = targetModel.label || "MODL";
            // Extract a 4-letter acronym or first 4 chars
            const shortLabel = labelStr.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();

            const { diffStr, diffColor } = this.diffTracker.getDiff(action.id, usagePercentage, { suffix: "%" });

            await action.setImage(generatePercentageSvg(usagePercentage, shortLabel, diffStr, diffColor));
            this.updatePiDisplay(action, `${usagePercentage}% / 100%`);

        } catch (e) {
            streamDeck.logger.error("Failed to check Antigravity Quota: " + e);
            await action.setImage(generateMessageSvg("Err", "Sys"));
        }
    }
}
