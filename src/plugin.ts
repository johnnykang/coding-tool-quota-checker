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
import { generateCountdownSvg, generateMessageSvg } from "./svg";

streamDeck.logger.setLevel(LogLevel.INFO);

// ─── Action UUID constants ────────────────────────────────────────────────────

const COPILOT_ACTION_UUID         = "au.jkang.codingtoolquotachecker.action";
const CLAUDE_ACTION_UUID          = "au.jkang.codingtoolquotachecker.claude";
const CLAUDE_CREDITS_ACTION_UUID  = "au.jkang.codingtoolquotachecker.claudecredits";
const ANTIGRAVITY_ACTION_UUID     = "au.jkang.codingtoolquotachecker.antigravity";
const OPENAI_CREDITS_ACTION_UUID  = "au.jkang.codingtoolquotachecker.openaicredits";
const DEEPSEEK_ACTION_UUID        = "au.jkang.codingtoolquotachecker.deepseek";
const FAL_ACTION_UUID             = "au.jkang.codingtoolquotachecker.fal";
const COUNTDOWN_ACTION_UUID       = "au.jkang.codingtoolquotachecker.countdown";

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
const POLL_INTERVAL_SECS = POLL_INTERVAL_MS / 1000;

const actionIntervals = new Map<string, NodeJS.Timeout>();
const lastPollTimestamps = new Map<string, number>();
const activeRunners = new Map<string, () => Promise<void>>();

/** (Re-)start the auto-poll interval for a single action. */
function startPolling(actionId: string, runner: () => Promise<void>): void {
    if (actionIntervals.has(actionId)) {
        clearInterval(actionIntervals.get(actionId)!);
    }
    lastPollTimestamps.set(actionId, Date.now());
    actionIntervals.set(actionId, setInterval(() => {
        lastPollTimestamps.set(actionId, Date.now());
        runner();
    }, POLL_INTERVAL_MS));
}

// ─── Countdown timer ──────────────────────────────────────────────────────────

const countdownActions = new Map<string, { action: KeyAction<any>; interval: NodeJS.Timeout }>();

function getSecondsUntilNextRefresh(): number | null {
    if (lastPollTimestamps.size === 0) return null;
    let minRemaining = Infinity;
    for (const timestamp of lastPollTimestamps.values()) {
        const remaining = POLL_INTERVAL_MS - (Date.now() - timestamp);
        if (remaining < minRemaining) minRemaining = remaining;
    }
    return Math.max(0, Math.ceil(minRemaining / 1000));
}

function updateAllCountdowns(): void {
    const secs = getSecondsUntilNextRefresh();
    for (const { action } of countdownActions.values()) {
        if (secs === null) {
            action.setImage(generateMessageSvg("--:--", "NO DATA", "#666"));
        } else {
            action.setImage(generateCountdownSvg(secs, POLL_INTERVAL_SECS));
        }
    }
}

// ─── Action lifecycle ─────────────────────────────────────────────────────────

streamDeck.actions.onWillAppear<AllSettings>((ev) => {
    const action = ev.action as KeyAction<any>;

    // Countdown actions have their own lifecycle
    if (action.manifestId === COUNTDOWN_ACTION_UUID) {
        const interval = setInterval(updateAllCountdowns, 1000);
        countdownActions.set(action.id, { action, interval });
        updateAllCountdowns();
        return;
    }

    const runner = getRunner(action);
    if (!runner) return;

    activeRunners.set(action.id, runner);
    runner();
    startPolling(action.id, runner);
});

streamDeck.actions.onWillDisappear<AllSettings>((ev) => {
    const action = ev.action as KeyAction<any>;

    if (countdownActions.has(action.id)) {
        clearInterval(countdownActions.get(action.id)!.interval);
        countdownActions.delete(action.id);
        return;
    }

    if (actionIntervals.has(action.id)) {
        clearInterval(actionIntervals.get(action.id)!);
        actionIntervals.delete(action.id);
    }
    activeRunners.delete(action.id);
    lastPollTimestamps.delete(action.id);
});

streamDeck.actions.onKeyDown<AllSettings>((ev) => {
    const action = ev.action as KeyAction<any>;

    // Countdown key press → refresh all buttons and reset their intervals
    if (action.manifestId === COUNTDOWN_ACTION_UUID) {
        for (const [id, runner] of activeRunners) {
            runner();
            startPolling(id, runner);
        }
        updateAllCountdowns();
        return;
    }

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
