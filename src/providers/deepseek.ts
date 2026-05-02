import { KeyAction } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { generateLoadingSvg, generateMessageSvg, generateCreditSvg } from "../svg";
import { IQuotaProvider, PiDisplayUpdater } from "./types";
import { DiffTracker } from "./diff-tracker";

export type DeepSeekSettings = {
    apiKey?: string;
};

type BalanceInfo = {
    currency: string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
};

type DeepSeekBalanceResponse = {
    is_available: boolean;
    balance_infos: BalanceInfo[];
};

export class DeepSeekProvider implements IQuotaProvider<DeepSeekSettings> {
    private readonly diffTracker = new DiffTracker();

    constructor(private readonly updatePiDisplay: PiDisplayUpdater) {}

    async check(action: KeyAction<DeepSeekSettings>): Promise<void> {
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

            const response = await fetch("https://api.deepseek.com/user/balance", {
                method: "GET",
                headers: {
                    "Accept": "application/json",
                    "Authorization": `Bearer ${apiKey.trim()}`
                }
            });

            if (response.status === 403 || response.status === 401) {
                streamDeck.logger.warn(`DeepSeek API: ${response.status} – api key may be invalid.`);
                await action.setImage(generateMessageSvg(response.status.toString(), "Auth?"));
                return;
            }

            if (!response.ok) {
                streamDeck.logger.error(`DeepSeek API error: ${response.status} ${response.statusText}`);
                await action.setImage(generateMessageSvg("Err", response.status.toString()));
                return;
            }

            const data: DeepSeekBalanceResponse = await response.json();

            if (!data.balance_infos || data.balance_infos.length === 0) {
                streamDeck.logger.error("DeepSeek API error: No balance infos");
                await action.setImage(generateMessageSvg("Err", "No Bal"));
                return;
            }

            const balanceInfo = data.balance_infos[0];
            const amountStr = balanceInfo.topped_up_balance;
            const amount = parseFloat(amountStr);
            const currency = balanceInfo.currency;
            
            const prefix = currency === "USD" ? "$" : (currency + " ");

            const { diffStr, diffColor } = this.diffTracker.getDiff(action.id, amount, { prefix });

            await action.setImage(generateCreditSvg(amount * 100, currency, "BALANCE", "DEEPSEEK", diffStr, diffColor));
            this.updatePiDisplay(action, `${prefix}${amount.toFixed(2)}`);

        } catch (e) {
            streamDeck.logger.error("Failed to fetch DeepSeek balance: " + e);
            await action.setImage(generateMessageSvg("Err", "Net"));
        }
    }
}
