import streamDeck, { LogLevel, Action, KeyAction } from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generatePercentageSvg, generateCountSvg } from "./svg";

streamDeck.logger.setLevel(LogLevel.INFO);

// Keep track of action instances to handle intervals
const actionInstances = new Map<string, NodeJS.Timeout>();

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

    } catch (e) {
        streamDeck.logger.error("Failed to fetch Claude usage: " + e);
        await action.setImage(generateMessageSvg("Err", "Net"));
    }
}

// ─── Action Lifecycle ─────────────────────────────────────────────────────────

const COPILOT_ACTION_UUID = "au.jkang.codingtoolquotachecker.action";
const CLAUDE_ACTION_UUID  = "au.jkang.codingtoolquotachecker.claude";

streamDeck.actions.onWillAppear<CopilotSettings | ClaudeSettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    const uuid = ev.action.manifestId;

    const runner = uuid === CLAUDE_ACTION_UUID
        ? () => checkClaudeUsage(action as KeyAction<ClaudeSettings>)
        : () => checkCopilotQuota(action as KeyAction<CopilotSettings>);

    runner();

    if (actionInstances.has(action.id)) {
        clearInterval(actionInstances.get(action.id)!);
    }

    const intervalId = setInterval(runner, 5 * 60 * 1000);
    actionInstances.set(action.id, intervalId);
});

streamDeck.actions.onWillDisappear<CopilotSettings | ClaudeSettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    if (actionInstances.has(action.id)) {
        clearInterval(actionInstances.get(action.id)!);
        actionInstances.delete(action.id);
    }
});

streamDeck.actions.onKeyDown<CopilotSettings | ClaudeSettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    const uuid = ev.action.manifestId;

    if (uuid === CLAUDE_ACTION_UUID) {
        checkClaudeUsage(action as KeyAction<ClaudeSettings>);
    } else {
        checkCopilotQuota(action as KeyAction<CopilotSettings>);
    }
});

streamDeck.connect();
