import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generatePercentageSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";
import { resolveSecret } from "../dpapi";

export type ClaudeUsageSettings = {
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

type PeriodKey = keyof Pick<ClaudeUsageResponse,
    "five_hour" | "seven_day" | "seven_day_sonnet" | "seven_day_omelette">;

const PERIOD_MAP: Record<string, PeriodKey[]> = {
    "5-hour":         ["five_hour"],
    "7-day":          ["seven_day"],
    "7-day-sonnet":   ["seven_day_sonnet", "seven_day"],
    "7-day-omelette": ["seven_day_omelette", "seven_day"],
};

const LABEL_MAP: Record<string, string> = {
    "5-hour":         "5H",
    "7-day":          "7D",
    "7-day-sonnet":   "S-7D",
    "7-day-omelette": "O-7D",
};

export class ClaudeUsageProvider implements IQuotaProvider<ClaudeUsageSettings> {
    private readonly diffTracker = new DiffTracker();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) {}

    async check(action: KeyAction<ClaudeUsageSettings>): Promise<void> {
        const settings = await action.getSettings();
        const { organizationId, usagePeriod = "5-hour" } = settings;
        const globalSettings = await streamDeck.settings.getGlobalSettings<Record<string, string>>();
        const sessionKey = await resolveSecret(globalSettings["claude.sessionKey"]);

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

            const keys = PERIOD_MAP[usagePeriod] ?? ["five_hour", "seven_day"];
            const periodData = keys.map(k => data[k]).find(p => p != null) ?? null;

            if (periodData === null || periodData === undefined) {
                streamDeck.logger.warn("Claude API: no data for selected period.");
                await action.setImage(generateMessageSvg("No", "Data"));
                return;
            }

            const pct = Math.round(periodData.utilization);
            const label = LABEL_MAP[usagePeriod] ?? usagePeriod.toUpperCase();

            const { diffStr, diffColor } = this.diffTracker.getDiff(action.id, pct, { suffix: "%", inverseColor: true });

            await action.setImage(generatePercentageSvg(pct, label, diffStr, diffColor));
            this.updatePiDisplay(action, `${pct}% / 100%`);

        } catch (e) {
            streamDeck.logger.error("Failed to fetch Claude usage: " + e);
            await action.setImage(generateMessageSvg("Err", "Net"));
        }
    }
}
