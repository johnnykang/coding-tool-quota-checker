import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generatePercentageSvg, generateCountSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";
import { AgyQuotaBucket, getAgyBuckets, getAgyCredits } from "./agy-cli";

export type AgyQuotaSettings = {
    bucketId?: string;
    modelLabel?: string;
    displayMode?: string;
};

export function selectAgyBucket(buckets: AgyQuotaBucket[], settings: AgyQuotaSettings): AgyQuotaBucket | undefined {
    if (settings.bucketId) return buckets.find(bucket => bucket.id === settings.bucketId);
    const label = settings.modelLabel?.trim().toLowerCase();
    let candidates = buckets.filter(bucket => bucket.remainingFraction !== undefined);
    if (label) {
        if (label.includes("argon")) candidates = candidates.filter(bucket => bucket.id.includes("argon"));
        else if (label.includes("claude") || label.includes("gpt")) candidates = candidates.filter(bucket => bucket.id.startsWith("3p-"));
        else if (label.includes("gemini")) candidates = candidates.filter(bucket => bucket.id.startsWith("gemini-") && !bucket.id.includes("argon"));
        else candidates = candidates.filter(bucket => bucket.id === label || bucket.name.toLowerCase() === label);
    }
    return candidates.reduce<AgyQuotaBucket | undefined>((lowest, bucket) =>
        !lowest || bucket.remainingFraction! < lowest.remainingFraction! ? bucket : lowest, undefined);
}

function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]!));
}

export class AgyQuotaProvider implements IQuotaProvider<AgyQuotaSettings> {
    private readonly diffTracker = new DiffTracker();
    private readonly checkSequences = new Map<string, number>();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) { }

    getBuckets(force = false): Promise<AgyQuotaBucket[]> {
        return getAgyBuckets(force);
    }

    async check(action: KeyAction<AgyQuotaSettings>, force = false): Promise<void> {
        const sequence = (this.checkSequences.get(action.id) ?? 0) + 1;
        this.checkSequences.set(action.id, sequence);
        const isCurrent = () => this.checkSequences.get(action.id) === sequence;
        try {
            const settings = await action.getSettings();
            if (!isCurrent()) return;
            await action.setImage(generateLoadingSvg());
            if (!isCurrent()) return;
            await action.setTitle("");
            if (!isCurrent()) return;
            if (settings.displayMode === "aiCredits") {
                const credits = await getAgyCredits(force);
                if (!isCurrent()) return;
                const { diffStr, diffColor } = this.diffTracker.getDiff(`${action.id}:credits`, credits, { prefix: "" });
                await action.setImage(generateCountSvg(credits, 0, "CREDITS", diffStr, diffColor, "AGY"));
                if (isCurrent()) this.updatePiDisplay(action, `${credits} Credits`);
                return;
            }

            const bucket = selectAgyBucket(await this.getBuckets(force), settings);
            if (!isCurrent()) return;
            if (!bucket || bucket.remainingFraction === undefined) {
                await action.setImage(generateMessageSvg("No Data", "AGY quota"));
                if (isCurrent()) this.updatePiDisplay(action, "Selected AGY quota is unavailable.");
                return;
            }
            const remaining = Math.round(bucket.remainingFraction * 100);
            const used = 100 - remaining;
            const { diffStr, diffColor } = this.diffTracker.getDiff(`${action.id}:${bucket.id}`, used, { suffix: "%", inverseColor: true });
            const group = /argon/i.test(bucket.group) ? "ARGON" : bucket.id.startsWith("3p-") ? "3P" : bucket.id.startsWith("gemini-") ? "GEMINI" : bucket.group.toUpperCase().slice(0, 6);
            const period = bucket.window === "weekly" ? "WEEK" : bucket.window.toUpperCase();
            await action.setImage(generatePercentageSvg(used, escapeXml(`${period} USED`), diffStr, diffColor, escapeXml(`AGY ${group}`)));
            const reset = bucket.resetTime ? ` / resets ${new Date(bucket.resetTime).toLocaleString()}` : "";
            if (isCurrent()) this.updatePiDisplay(action, `${bucket.group} (${bucket.window}): ${used}% used / ${remaining}% remaining${reset}`);
        } catch (error) {
            if (!isCurrent()) return;
            const message = error instanceof Error ? error.message : "AGY query failed.";
            streamDeck.logger.error(`Failed to check AGY quota: ${message}`);
            await action.setImage(generateMessageSvg("Error", "AGY CLI"));
            if (isCurrent()) this.updatePiDisplay(action, message);
        }
    }
}
