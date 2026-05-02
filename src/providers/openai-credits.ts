import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generateCreditSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";
import { resolveSecret } from "../dpapi";

export type OpenAiCreditsSettings = {
    sessionToken?: string;
};

type CreditGrantsResponse = {
    object: string;
    total_granted: number;
    total_used: number;
    total_available: number;
    total_paid_available: number;
};

export class OpenAiCreditsProvider implements IQuotaProvider<OpenAiCreditsSettings> {
    private readonly diffTracker = new DiffTracker();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) {}

    async check(action: KeyAction<OpenAiCreditsSettings>): Promise<void> {
        const globalSettings = await streamDeck.settings.getGlobalSettings<Record<string, string>>();
        const sessionToken = await resolveSecret(globalSettings["openai.sessionToken"]);

        if (!sessionToken) {
            await action.setImage(generateMessageSvg("No", "Token"));
            await action.setTitle("");
            return;
        }

        try {
            await action.setImage(generateLoadingSvg());
            await action.setTitle("");

            const response = await fetch("https://api.openai.com/v1/dashboard/billing/credit_grants", {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${sessionToken.trim()}`,
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                }
            });

            if (response.status === 403 || response.status === 401) {
                streamDeck.logger.warn(`OpenAI credits API: ${response.status} – session token may be invalid or expired.`);
                await action.setImage(generateMessageSvg(response.status.toString(), "Auth?"));
                return;
            }

            if (!response.ok) {
                streamDeck.logger.error(`OpenAI credits API error: ${response.status} ${response.statusText}`);
                await action.setImage(generateMessageSvg("Err", response.status.toString()));
                return;
            }

            const data: CreditGrantsResponse = await response.json();

            // total_available is already in dollars (not cents)
            const amountDollars = data.total_available;
            const { diffStr, diffColor } = this.diffTracker.getDiff(action.id, amountDollars, { prefix: "$" });

            await action.setImage(generateCreditSvg(amountDollars * 100, "USD", "CREDITS", "OPENAI", diffStr, diffColor));
            this.updatePiDisplay(action, `$${amountDollars.toFixed(2)}`);

        } catch (e) {
            streamDeck.logger.error("Failed to fetch OpenAI credits: " + e);
            await action.setImage(generateMessageSvg("Err", "Net"));
        }
    }
}
