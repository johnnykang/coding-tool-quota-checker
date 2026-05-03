import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generatePercentageSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";
import { resolveSecret } from "../dpapi";

export type OpenCodeGoSettings = {
    workspaceId?: string;
    window?: "rolling" | "weekly" | "monthly";
};

const DASHBOARD_URL_PREFIX = "https://opencode.ai/workspace/";
const DASHBOARD_URL_SUFFIX = "/go";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";
const SCRAPE_TIMEOUT_MS = 10_000;

const SCRAPED_NUMBER_PATTERN = String.raw`(-?\d+(?:\.\d+)?)`;

const RE_ROLLING_PCT_FIRST = new RegExp(
    String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_ROLLING_RESET_FIRST = new RegExp(
    String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

const RE_WEEKLY_PCT_FIRST = new RegExp(
    String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_WEEKLY_RESET_FIRST = new RegExp(
    String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

const RE_MONTHLY_PCT_FIRST = new RegExp(
    String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_MONTHLY_RESET_FIRST = new RegExp(
    String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

interface ScrapedWindowUsage {
    usagePercent: number;
    resetInSec: number;
}

function parseWindowUsage(
    html: string,
    rePctFirst: RegExp,
    reResetFirst: RegExp,
): ScrapedWindowUsage | null {
    const pctFirstMatch = rePctFirst.exec(html);
    if (pctFirstMatch) {
        const usagePercent = Number(pctFirstMatch[1]);
        const resetInSec = Number(pctFirstMatch[2]);
        if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
            return { usagePercent, resetInSec };
        }
    }

    const resetFirstMatch = reResetFirst.exec(html);
    if (resetFirstMatch) {
        const resetInSec = Number(resetFirstMatch[1]);
        const usagePercent = Number(resetFirstMatch[2]);
        if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
            return { usagePercent, resetInSec };
        }
    }

    return null;
}

function sanitizeMessage(text: string, maxLength = 120): string {
    const sanitized = text.replace(/\s+/g, " ").trim();
    return (sanitized || "unknown").slice(0, maxLength);
}

const WINDOW_LABELS: Record<string, string> = {
    rolling: "5H",
    weekly: "WEEKLY",
    monthly: "MONTHLY",
};

export class OpenCodeGoProvider implements IQuotaProvider<OpenCodeGoSettings> {
    private readonly diffTracker = new DiffTracker();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) {}

    async check(action: KeyAction<OpenCodeGoSettings>): Promise<void> {
        const settings = await action.getSettings();
        const workspaceId = settings.workspaceId?.trim();
        const window = settings.window ?? "rolling";

        const globalSettings = await streamDeck.settings.getGlobalSettings<Record<string, string>>();
        const authCookie = await resolveSecret(globalSettings["opencodego.authCookie"]);

        if (!workspaceId) {
            await action.setImage(generateMessageSvg("No", "ID"));
            await action.setTitle("");
            return;
        }

        if (!authCookie) {
            await action.setImage(generateMessageSvg("No", "Cookie"));
            await action.setTitle("");
            return;
        }

        try {
            await action.setImage(generateLoadingSvg());
            await action.setTitle("");

            const url = `${DASHBOARD_URL_PREFIX}${encodeURIComponent(workspaceId)}${DASHBOARD_URL_SUFFIX}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "User-Agent": USER_AGENT,
                    Accept: "text/html",
                    Cookie: `auth=${authCookie}`,
                },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const text = await response.text();
                streamDeck.logger.error(`OpenCode Go dashboard error ${response.status}: ${sanitizeMessage(text)}`);
                await action.setImage(generateMessageSvg("Err", response.status.toString()));
                return;
            }

            const html = await response.text();

            const rolling = parseWindowUsage(html, RE_ROLLING_PCT_FIRST, RE_ROLLING_RESET_FIRST);
            const weekly = parseWindowUsage(html, RE_WEEKLY_PCT_FIRST, RE_WEEKLY_RESET_FIRST);
            const monthly = parseWindowUsage(html, RE_MONTHLY_PCT_FIRST, RE_MONTHLY_RESET_FIRST);

            if (!rolling && !weekly && !monthly) {
                streamDeck.logger.error("OpenCode Go: could not parse any usage windows");
                await action.setImage(generateMessageSvg("No", "Data"));
                return;
            }

            const windows: Record<string, ScrapedWindowUsage | null> = { rolling, weekly, monthly };
            const usage = windows[window];

            if (!usage) {
                await action.setImage(generateMessageSvg("No", window.toUpperCase()));
                return;
            }

            const usagePercent = Math.max(0, usage.usagePercent);
            const percentRemaining = Math.round(100 - usagePercent);
            const label = WINDOW_LABELS[window] ?? window.toUpperCase();

            const { diffStr, diffColor } = this.diffTracker.getDiff(action.id, percentRemaining, { suffix: "%" });

            await action.setImage(generatePercentageSvg(percentRemaining, label, diffStr, diffColor, "OC GO"));
            this.updatePiDisplay(action, `${percentRemaining}% / 100%`);

        } catch (e) {
            streamDeck.logger.error("Failed to fetch OpenCode Go quota: " + e);
            await action.setImage(generateMessageSvg("Err", "Net"));
        }
    }
}
