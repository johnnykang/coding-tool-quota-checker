import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generateCreditSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";

export type FalCreditsSettings = {
    apiKey?: string;
};

type FalBillingResponse = {
    username: string;
    credits?: {
        current_balance: number;
        currency: string;
    };
};

export class FalCreditsProvider implements IQuotaProvider<FalCreditsSettings> {
    private readonly diffTracker = new DiffTracker();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) {}

    async check(action: KeyAction<FalCreditsSettings>): Promise<void> {
        const settings = await action.getSettings();
        const { apiKey } = settings;

        if (!apiKey) {
            await action.setImage(generateMessageSvg("No", "Key"));
            await action.setTitle("");
            return;
        }

        try {
            await action.setImage(generateLoadingSvg());
            await action.setTitle("");

            const authHeader = apiKey.trim().startsWith("Key ") ? apiKey.trim() : `Key ${apiKey.trim()}`;

            const response = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
                method: "GET",
                headers: {
                    "Accept": "application/json",
                    "Authorization": authHeader
                }
            });

            if (response.status === 403 || response.status === 401) {
                streamDeck.logger.warn(`FAL API: ${response.status} – api key may be invalid.`);
                await action.setImage(generateMessageSvg(response.status.toString(), "Auth?"));
                return;
            }

            if (!response.ok) {
                streamDeck.logger.error(`FAL API error: ${response.status} ${response.statusText}`);
                await action.setImage(generateMessageSvg("Err", response.status.toString()));
                return;
            }

            const data: FalBillingResponse = await response.json();

            if (!data.credits) {
                streamDeck.logger.error("FAL API error: No credits returned in response");
                await action.setImage(generateMessageSvg("Err", "No Bal"));
                return;
            }

            const amount = data.credits.current_balance;
            const currency = data.credits.currency;
            
            const prefix = currency === "USD" ? "$" : (currency + " ");

            const { diffStr, diffColor } = this.diffTracker.getDiff(action.id, amount, { prefix });

            await action.setImage(generateCreditSvg(amount * 100, currency, "BALANCE", "FAL.AI", diffStr, diffColor));
            this.updatePiDisplay(action, `${prefix}${amount.toFixed(2)}`);

        } catch (e) {
            streamDeck.logger.error("Failed to fetch FAL balance: " + e);
            await action.setImage(generateMessageSvg("Err", "Net"));
        }
    }
}
