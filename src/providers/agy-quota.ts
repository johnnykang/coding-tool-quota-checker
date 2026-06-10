import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import os from "os";
import { generateLoadingSvg, generateMessageSvg, generatePercentageSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";

export type AgyQuotaSettings = {
    modelLabel?: string;
};

interface QuotaCache {
    models?: Record<string, {
        name: string;
        remaining_percentage: number;
        reset_time?: string;
        refreshes_in?: string;
    }>;
    updatedAt?: number;
    email?: string;
    planTier?: string;
    aiCredits?: string;
    planStatus?: Record<string, any>;
}

function normalizeModelName(name: string): string {
    return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readQuotaCache(): QuotaCache | null {
    const cachePath = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
    try {
        if (!existsSync(cachePath)) return null;
        const data = JSON.parse(readFileSync(cachePath, 'utf8'));
        return data as QuotaCache;
    } catch (e) {
        return null;
    }
}

export class AgyQuotaProvider implements IQuotaProvider<AgyQuotaSettings> {
    private readonly diffTracker = new DiffTracker();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) { }

    async check(action: KeyAction<AgyQuotaSettings>): Promise<void> {
        const settings = await action.getSettings();
        const modelLabel = settings.modelLabel?.toLowerCase().trim();

        try {
            await action.setImage(generateLoadingSvg());
            await action.setTitle("");

            const cache = readQuotaCache();
            if (!cache || !cache.models || Object.keys(cache.models).length === 0) {
                await action.setImage(generateMessageSvg("No", "Cache"));
                return;
            }

            // Check cache freshness (warn if older than 2 minutes)
            const cacheAge = cache.updatedAt ? Date.now() - cache.updatedAt : Infinity;
            if (cacheAge > 120000) {
                streamDeck.logger.warn(`AGY quota cache is stale (${Math.round(cacheAge / 1000)}s old)`);
            }

            const models = cache.models;
            const normLabel = modelLabel ? normalizeModelName(modelLabel) : null;
            let targetModel = null;

            // Priority 1: Exact match on normalized name
            if (normLabel && models[normLabel]) {
                targetModel = models[normLabel];
            }

            // Priority 2: Substring fuzzy match
            if (!targetModel && normLabel) {
                for (const k in models) {
                    if (k.includes(normLabel) || normLabel.includes(k)) {
                        targetModel = models[k];
                        break;
                    }
                }
            }

            // Priority 3: Family match (claude, gemini, gpt)
            if (!targetModel && normLabel) {
                const families = ['claude', 'gemini', 'gpt'];
                const modelFamily = families.find(f => normLabel.includes(f));
                if (modelFamily) {
                    for (const k in models) {
                        if (k.includes(modelFamily)) {
                            if (!targetModel || models[k].remaining_percentage < targetModel.remaining_percentage) {
                                targetModel = models[k];
                            }
                        }
                    }
                }
            }

            // Priority 4: Lowest remaining percentage across all models (most critical)
            if (!targetModel) {
                const allKeys = Object.keys(models);
                targetModel = allKeys.reduce((min, k) =>
                    models[k].remaining_percentage < min.remaining_percentage ? models[k] : min
                , models[allKeys[0]]);
            }

            if (!targetModel) {
                await action.setImage(generateMessageSvg("No", "Quota"));
                return;
            }

            const remainingPercentage = Math.round(targetModel.remaining_percentage);
            const usagePercentage = 100 - remainingPercentage;

            // Use a short label for the model
            const labelStr = targetModel.name || "AGY";
            const shortLabel = labelStr.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();

            const { diffStr, diffColor } = this.diffTracker.getDiff(action.id, usagePercentage, { suffix: "%" });

            await action.setImage(generatePercentageSvg(usagePercentage, shortLabel, diffStr, diffColor, "AGY"));
            this.updatePiDisplay(action, `${usagePercentage}% used / ${remainingPercentage}% remaining`);

            streamDeck.logger.info(`AGY quota: ${labelStr} = ${remainingPercentage}% remaining, plan: ${cache.planTier || 'unknown'}, email: ${cache.email || 'unknown'}`);

        } catch (e) {
            streamDeck.logger.error("Failed to check AGY Quota: " + e);
            await action.setImage(generateMessageSvg("Err", "Sys"));
        }
    }
}
