import streamDeck, { LogLevel, Action, KeyAction } from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generatePercentageSvg, generateCountSvg, generateCreditSvg } from "./svg";
import { exec } from "child_process";
import { promisify } from "util";
import * as https from "https";

const execAsync = promisify(exec);

streamDeck.logger.setLevel(LogLevel.INFO);

// Keep track of action instances to handle intervals
const actionInstances = new Map<string, NodeJS.Timeout>();

// Keep track of latest display values for PI
const latestDisplayValues = new Map<string, string>();

function updatePiDisplay(action: KeyAction<any>, displayValue: string) {
    latestDisplayValues.set(action.id, displayValue);
    if (streamDeck.ui.current?.action.id === action.id) {
        streamDeck.ui.current.sendToPropertyInspector({
            type: "updateDisplay",
            value: displayValue
        });
    }
}

streamDeck.ui.onDidAppear((ev) => {
    const val = latestDisplayValues.get(ev.action.id);
    if (val && streamDeck.ui.current?.action.id === ev.action.id) {
        streamDeck.ui.current.sendToPropertyInspector({
            type: "updateDisplay",
            value: val
        });
    }
});

// ─── Copilot Quota Action ────────────────────────────────────────────────────

type CopilotSettings = {
    authToken?: string;
};

async function checkCopilotQuota(action: KeyAction<CopilotSettings>) {
    const settings = await action.getSettings();
    const token = settings.authToken;

    if (!token) {
        await action.setImage(generateMessageSvg("No", "Token"));
        await action.setTitle("");
        return;
    }

    try {
        await action.setImage(generateLoadingSvg());
        await action.setTitle("");

        const response = await fetch("https://api.github.com/copilot_internal/user", {
            headers: {
                "Authorization": `token ${token}`,
                "User-Agent": "StreamDeck Copilot Quota/1.0"
            }
        });

        if (!response.ok) {
            streamDeck.logger.error(`Copilot API Error: ${response.status} ${response.statusText}`);
            await action.setImage(generateMessageSvg("Err", "Auth?"));
            return;
        }

        const data = await response.json();
        const remaining = data?.quota_snapshots?.premium_interactions?.remaining;
        const limit = data?.quota_snapshots?.premium_interactions?.entitlement || remaining;

        if (remaining !== undefined) {
            await action.setImage(generateCountSvg(remaining, limit, "LEFT"));
            updatePiDisplay(action, `${remaining} / ${limit}`);
        } else {
            await action.setImage(generateMessageSvg("Err", "Data"));
        }

    } catch (e) {
        streamDeck.logger.error("Failed to fetch Copilot quota: " + e);
        await action.setImage(generateMessageSvg("Err", "Net"));
    }
}

// ─── Claude Code Usage Action ─────────────────────────────────────────────────

type ClaudeSettings = {
    sessionKey?: string;
    organizationId?: string;
    usagePeriod?: "5-hour" | "7-day" | "7-day-sonnet" | "7-day-omelette";
};

/**
 * Response shape from https://claude.ai/api/organizations/{orgId}/usage
 * The utilisation values are percentages (0–100).
 */
type UsagePeriod = { utilization: number; resets_at: string | null } | null;

type ClaudeUsageResponse = {
    five_hour?:             UsagePeriod;
    seven_day?:             UsagePeriod;
    seven_day_oauth_apps?:  UsagePeriod;
    seven_day_opus?:        UsagePeriod;
    seven_day_sonnet?:      UsagePeriod;
    seven_day_cowork?:      UsagePeriod;
    seven_day_omelette?:    UsagePeriod;
    iguana_necktie?:        UsagePeriod;
    omelette_promotional?:  UsagePeriod;
    extra_usage?: {
        is_enabled:     boolean;
        monthly_limit:  number | null;
        used_credits:   number;
        utilization:    number | null;
        currency:       string;
    } | null;
};

async function checkClaudeUsage(action: KeyAction<ClaudeSettings>) {
    const settings = await action.getSettings();
    const { sessionKey, organizationId, usagePeriod = "5-hour" } = settings;

    if (!sessionKey || !organizationId) {
        await action.setImage(generateMessageSvg("No", "Creds"));
        await action.setTitle("");
        return;
    }

    try {
        await action.setImage(generateLoadingSvg());
        await action.setTitle("");

        // Strip leading/trailing whitespace and extract the key value if a
        // full cookie string was pasted (e.g. "sessionKey=sk-ant-sid01-...")
        const rawKey = sessionKey.trim();
        const parsedKey = rawKey.includes("sessionKey=")
            ? (rawKey.match(/sessionKey=([^;]+)/)?.[1]?.trim() ?? rawKey)
            : rawKey;

        const orgId = organizationId.trim();
        const url = `https://claude.ai/api/organizations/${orgId}/usage`;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "accept": "*/*",
                "anthropic-client-platform": "web_claude_ai",
                // Session cookie passed directly. Works when Cloudflare is not
                // actively challenging. If 403, the user needs a fresh key.
                "cookie": `sessionKey=${parsedKey}; lastActiveOrg=${orgId}`,
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            }
        });

        if (response.status === 403) {
            streamDeck.logger.warn("Claude API: 403 – session key may be expired or Cloudflare is blocking.");
            await action.setImage(generateMessageSvg("403", "Expired?"));
            return;
        }

        if (!response.ok) {
            streamDeck.logger.error(`Claude API Error: ${response.status} ${response.statusText}`);
            await action.setImage(generateMessageSvg("Err", response.status.toString()));
            return;
        }

        const data: ClaudeUsageResponse = await response.json();

        // Select the period data based on settings, with sensible fallbacks.
        type PeriodKey = keyof Pick<ClaudeUsageResponse,
            "five_hour" | "seven_day" | "seven_day_sonnet" | "seven_day_omelette">;

        const periodMap: Record<string, PeriodKey[]> = {
            "5-hour":           ["five_hour"],
            "7-day":            ["seven_day"],
            "7-day-sonnet":     ["seven_day_sonnet", "seven_day"],
            "7-day-omelette":   ["seven_day_omelette", "seven_day"],
        };

        const keys = periodMap[usagePeriod] ?? ["five_hour", "seven_day"];
        const periodData = keys.map(k => data[k]).find(p => p != null) ?? null;

        if (periodData === null || periodData === undefined) {
            streamDeck.logger.warn("Claude API: no data for selected period.");
            await action.setImage(generateMessageSvg("No", "Data"));
            return;
        }

        const pct = Math.round(periodData.utilization);

        // Short label for the key face
        const labelMap: Record<string, string> = {
            "5-hour":         "5H",
            "7-day":          "7D",
            "7-day-sonnet":   "S-7D",
            "7-day-omelette": "O-7D",
        };
        const label = labelMap[usagePeriod] ?? usagePeriod.toUpperCase();

        await action.setImage(generatePercentageSvg(pct, label));
        updatePiDisplay(action, `${pct}% / 100%`);

    } catch (e) {
        streamDeck.logger.error("Failed to fetch Claude usage: " + e);
        await action.setImage(generateMessageSvg("Err", "Net"));
    }
}

// ─── Claude Code Credits Action ─────────────────────────────────────────────────

type ClaudeCreditsSettings = {
    apiKey?: string;
    organizationId?: string;
};

type ClaudeCreditsResponse = {
    amount: number;
    currency: string;
    auto_reload_settings: any;
    pending_invoice_amount_cents: any;
};

async function checkClaudeCredits(action: KeyAction<ClaudeCreditsSettings>) {
    const settings = await action.getSettings();
    const { apiKey, organizationId } = settings;

    if (!apiKey || !organizationId) {
        await action.setImage(generateMessageSvg("No", "Creds"));
        await action.setTitle("");
        return;
    }

    try {
        await action.setImage(generateLoadingSvg());
        await action.setTitle("");

        const token = apiKey.trim();
        const orgId = organizationId.trim();
        const url = `https://platform.claude.com/api/organizations/${orgId}/prepaid/credits`;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            }
        });

        if (response.status === 403 || response.status === 401) {
            streamDeck.logger.warn("Claude API: 401/403 – API key may be invalid.");
            await action.setImage(generateMessageSvg(response.status.toString(), "Auth?"));
            return;
        }

        if (!response.ok) {
            streamDeck.logger.error(`Claude API Error: ${response.status} ${response.statusText}`);
            await action.setImage(generateMessageSvg("Err", response.status.toString()));
            return;
        }

        const data: ClaudeCreditsResponse = await response.json();

        await action.setImage(generateCreditSvg(data.amount, data.currency, "CREDITS"));
        const dollars = (data.amount / 100).toFixed(2);
        const prefix = data.currency === "USD" ? "$" : data.currency + " ";
        updatePiDisplay(action, `${prefix}${dollars}`);

    } catch (e) {
        streamDeck.logger.error("Failed to fetch Claude credits: " + e);
        await action.setImage(generateMessageSvg("Err", "Net"));
    }
}

// ─── Antigravity Quota Action ───────────────────────────────────────────────────

type AntigravitySettings = {
    modelLabel?: string;
};

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
                } catch(e) {
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

async function checkAntigravityQuota(action: KeyAction<AntigravitySettings>) {
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
        const remainingPercentage = remainingFraction !== undefined ? Math.round(remainingFraction * 100) : 0;
        
        const labelStr = targetModel.label || "MODL";
        // Extract a 4 letter acronym or first 4 chars
        const shortLabel = labelStr.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
        
        await action.setImage(generatePercentageSvg(remainingPercentage, shortLabel));
        updatePiDisplay(action, `${remainingPercentage}% / 100%`);

    } catch (e) {
        streamDeck.logger.error("Failed to check Antigravity Quota: " + e);
        await action.setImage(generateMessageSvg("Err", "Sys"));
    }
}

// ─── Action Lifecycle ─────────────────────────────────────────────────────────

const COPILOT_ACTION_UUID = "au.jkang.codingtoolquotachecker.action";
const CLAUDE_ACTION_UUID  = "au.jkang.codingtoolquotachecker.claude";
const CLAUDE_CREDITS_ACTION_UUID = "au.jkang.codingtoolquotachecker.claudecredits";
const ANTIGRAVITY_ACTION_UUID = "au.jkang.codingtoolquotachecker.antigravity";

streamDeck.actions.onWillAppear<CopilotSettings | ClaudeSettings | ClaudeCreditsSettings | AntigravitySettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    const uuid = ev.action.manifestId;

    let runner: () => Promise<void>;
    if (uuid === CLAUDE_ACTION_UUID) {
        runner = () => checkClaudeUsage(action as KeyAction<ClaudeSettings>);
    } else if (uuid === CLAUDE_CREDITS_ACTION_UUID) {
        runner = () => checkClaudeCredits(action as KeyAction<ClaudeCreditsSettings>);
    } else if (uuid === ANTIGRAVITY_ACTION_UUID) {
        runner = () => checkAntigravityQuota(action as KeyAction<AntigravitySettings>);
    } else {
        runner = () => checkCopilotQuota(action as KeyAction<CopilotSettings>);
    }

    runner();

    if (actionInstances.has(action.id)) {
        clearInterval(actionInstances.get(action.id)!);
    }

    const intervalId = setInterval(runner, 5 * 60 * 1000);
    actionInstances.set(action.id, intervalId);
});

streamDeck.actions.onWillDisappear<CopilotSettings | ClaudeSettings | ClaudeCreditsSettings | AntigravitySettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    if (actionInstances.has(action.id)) {
        clearInterval(actionInstances.get(action.id)!);
        actionInstances.delete(action.id);
    }
});

streamDeck.actions.onKeyDown<CopilotSettings | ClaudeSettings | ClaudeCreditsSettings | AntigravitySettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    const uuid = ev.action.manifestId;

    if (uuid === CLAUDE_ACTION_UUID) {
        checkClaudeUsage(action as KeyAction<ClaudeSettings>);
    } else if (uuid === CLAUDE_CREDITS_ACTION_UUID) {
        checkClaudeCredits(action as KeyAction<ClaudeCreditsSettings>);
    } else if (uuid === ANTIGRAVITY_ACTION_UUID) {
        checkAntigravityQuota(action as KeyAction<AntigravitySettings>);
    } else {
        checkCopilotQuota(action as KeyAction<CopilotSettings>);
    }
});

streamDeck.connect();
