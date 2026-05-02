import streamDeck, { LogLevel, KeyAction } from "@elgato/streamdeck";

import { PiDisplayUpdater } from "./providers/types";
import { CopilotProvider, CopilotSettings } from "./providers/copilot";
import { ClaudeUsageProvider, ClaudeUsageSettings } from "./providers/claude-usage";
import { ClaudeCreditsProvider, ClaudeCreditsSettings } from "./providers/claude-credits";
import { AntigravityProvider, AntigravitySettings } from "./providers/antigravity";
import { OpenAiCreditsProvider, OpenAiCreditsSettings } from "./providers/openai-credits";
import { DeepSeekProvider, DeepSeekSettings } from "./providers/deepseek";
import { FalCreditsProvider, FalCreditsSettings } from "./providers/fal-credits";
import { encryptDpapi, isDpapiEncrypted } from "./dpapi";

streamDeck.logger.setLevel(LogLevel.INFO);

// ─── Action UUID constants ────────────────────────────────────────────────────

const COPILOT_ACTION_UUID         = "au.jkang.codingtoolquotachecker.action";
const CLAUDE_ACTION_UUID          = "au.jkang.codingtoolquotachecker.claude";
const CLAUDE_CREDITS_ACTION_UUID  = "au.jkang.codingtoolquotachecker.claudecredits";
const ANTIGRAVITY_ACTION_UUID     = "au.jkang.codingtoolquotachecker.antigravity";
const OPENAI_CREDITS_ACTION_UUID  = "au.jkang.codingtoolquotachecker.openaicredits";
const DEEPSEEK_ACTION_UUID        = "au.jkang.codingtoolquotachecker.deepseek";
const FAL_ACTION_UUID             = "au.jkang.codingtoolquotachecker.fal";

// ─── PI display state ─────────────────────────────────────────────────────────

/** Latest display value per action instance, so the PI gets it on (re-)open. */
const latestDisplayValues = new Map<string, string>();

const updatePiDisplay: PiDisplayUpdater = (action, displayValue) => {
    latestDisplayValues.set(action.id, displayValue);
    if (streamDeck.ui.current?.action.id === action.id) {
        streamDeck.ui.current.sendToPropertyInspector({
            type: "updateDisplay",
            value: displayValue
        });
    }
};

streamDeck.ui.onDidAppear((ev) => {
    const val = latestDisplayValues.get(ev.action.id);
    if (val && streamDeck.ui.current?.action.id === ev.action.id) {
        streamDeck.ui.current.sendToPropertyInspector({
            type: "updateDisplay",
            value: val
        });
    }
});

// ─── Provider registry ────────────────────────────────────────────────────────

const providers = {
    [COPILOT_ACTION_UUID]:        new CopilotProvider(updatePiDisplay),
    [CLAUDE_ACTION_UUID]:         new ClaudeUsageProvider(updatePiDisplay),
    [CLAUDE_CREDITS_ACTION_UUID]: new ClaudeCreditsProvider(updatePiDisplay),
    [ANTIGRAVITY_ACTION_UUID]:    new AntigravityProvider(updatePiDisplay),
    [OPENAI_CREDITS_ACTION_UUID]: new OpenAiCreditsProvider(updatePiDisplay),
    [DEEPSEEK_ACTION_UUID]:       new DeepSeekProvider(updatePiDisplay),
    [FAL_ACTION_UUID]:            new FalCreditsProvider(updatePiDisplay),
};

type AllSettings = CopilotSettings | ClaudeUsageSettings | ClaudeCreditsSettings | AntigravitySettings | OpenAiCreditsSettings | DeepSeekSettings | FalCreditsSettings;

function getRunner(action: KeyAction<any>): (() => Promise<void>) | null {
    const provider = providers[action.manifestId as keyof typeof providers];
    if (!provider) return null;
    return () => provider.check(action);
}

// ─── Interval management ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const actionIntervals = new Map<string, NodeJS.Timeout>();

// ─── Action lifecycle ─────────────────────────────────────────────────────────

streamDeck.actions.onWillAppear<AllSettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    const runner = getRunner(action);
    if (!runner) return;

    runner();

    if (actionIntervals.has(action.id)) {
        clearInterval(actionIntervals.get(action.id)!);
    }

    actionIntervals.set(action.id, setInterval(runner, POLL_INTERVAL_MS));
});

streamDeck.actions.onWillDisappear<AllSettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    if (actionIntervals.has(action.id)) {
        clearInterval(actionIntervals.get(action.id)!);
        actionIntervals.delete(action.id);
    }
});

streamDeck.actions.onKeyDown<AllSettings>((ev) => {
    const action = ev.action as KeyAction<any>;
    getRunner(action)?.();
});

// ─── Secret management (PI → plugin) ─────────────────────────────────────────

type SecretMessage =
    | { type: "saveSecret"; key: string; value: string }
    | { type: "getSecretStatus"; keys: string[] };

streamDeck.ui.onSendToPlugin<SecretMessage>(async (ev) => {
    const msg = ev.payload;

    if (msg.type === "saveSecret") {
        const { key, value } = msg;
        let stored: string;
        if (process.platform === "win32") {
            try {
                stored = await encryptDpapi(value);
            } catch (e) {
                streamDeck.logger.error(`DPAPI encrypt failed for key '${key}': ${e}`);
                return;
            }
        } else {
            stored = value; // macOS/Linux: store plaintext
        }
        const current = await streamDeck.settings.getGlobalSettings<Record<string, string>>();
        await streamDeck.settings.setGlobalSettings({ ...current, [key]: stored });
        streamDeck.logger.info(`Secret saved for key '${key}'`);
        return;
    }

    if (msg.type === "getSecretStatus") {
        const globals = await streamDeck.settings.getGlobalSettings<Record<string, string>>();
        const status: Record<string, boolean> = {};
        for (const k of msg.keys) {
            const val = globals[k] ?? "";
            status[k] = process.platform === "win32"
                ? isDpapiEncrypted(val)
                : val.length > 0;
        }
        streamDeck.ui.current?.sendToPropertyInspector({ type: "secretStatus", status });
        return;
    }
});

streamDeck.connect();
