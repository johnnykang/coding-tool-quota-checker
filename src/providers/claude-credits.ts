import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generateCreditSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";

export type ClaudeCreditsSettings = {
    apiKey?: string;
    organizationId?: string;
};

type ClaudeCreditsResponse = {
    amount: number;
    currency: string;
    auto_reload_settings: any;
    pending_invoice_amount_cents: any;
};

export class ClaudeCreditsProvider implements IQuotaProvider<ClaudeCreditsSettings> {
    private readonly diffTracker = new DiffTracker();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) {}

    async check(action: KeyAction<ClaudeCreditsSettings>): Promise<void> {
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

            // Track diff using dollars, although data.amount is in cents
            const amountDollars = data.amount / 100;
            const { diffStr, diffColor } = this.diffTracker.getDiff(action.id, amountDollars, { prefix: data.currency === "USD" ? "$" : data.currency + " " });

            await action.setImage(generateCreditSvg(data.amount, data.currency, "CREDITS", "CLAUDE", diffStr, diffColor));
            const dollars = amountDollars.toFixed(2);
            const prefix = data.currency === "USD" ? "$" : data.currency + " ";
            this.updatePiDisplay(action, `${prefix}${dollars}`);

        } catch (e) {
            streamDeck.logger.error("Failed to fetch Claude credits: " + e);
            await action.setImage(generateMessageSvg("Err", "Net"));
        }
    }
}
