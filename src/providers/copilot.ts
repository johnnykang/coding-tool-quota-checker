import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generateCountSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";

export type CopilotSettings = {
    authToken?: string;
};

export class CopilotProvider implements IQuotaProvider<CopilotSettings> {
    constructor(private readonly updatePiDisplay: PiDisplayUpdater) {}

    async check(action: KeyAction<CopilotSettings>): Promise<void> {
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
                this.updatePiDisplay(action, `${remaining} / ${limit}`);
            } else {
                await action.setImage(generateMessageSvg("Err", "Data"));
            }

        } catch (e) {
            streamDeck.logger.error("Failed to fetch Copilot quota: " + e);
            await action.setImage(generateMessageSvg("Err", "Net"));
        }
    }
}
