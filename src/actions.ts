import streamDeck, { action, KeyDownEvent, KeyAction, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { JsonObject } from "@elgato/utils";

import { PiDisplayUpdater } from "./providers/types";
import { AntigravityProvider, AntigravitySettings } from "./providers/antigravity";
import { ClaudeCreditsProvider, ClaudeCreditsSettings } from "./providers/claude-credits";
import { ClaudeUsageProvider, ClaudeUsageSettings } from "./providers/claude-usage";
import { CopilotProvider, CopilotSettings } from "./providers/copilot";
import { DeepSeekProvider, DeepSeekSettings } from "./providers/deepseek";
import { FalCreditsProvider, FalCreditsSettings } from "./providers/fal-credits";
import { OpenAiCreditsProvider, OpenAiCreditsSettings } from "./providers/openai-credits";
import { OpenCodeGoProvider, OpenCodeGoSettings } from "./providers/opencode-go";
import { generateCountdownSvg, generateMessageSvg } from "./svg";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Latest display value per action instance, so the PI gets it on (re-)open. */
export const latestDisplayValues = new Map<string, string>();

const updatePiDisplay: PiDisplayUpdater = (action, displayValue) => {
	latestDisplayValues.set(action.id, displayValue);
	if (streamDeck.ui.action?.id === action.id) {
		streamDeck.ui.sendToPropertyInspector({
			type: "updateDisplay",
			value: displayValue
		});
	}
};

/** Shared registry of active polling runners per action instance. */
const activeRunners = new Map<string, () => Promise<void>>();
const actionIntervals = new Map<string, NodeJS.Timeout>();
export const lastPollTimestamps = new Map<string, number>();

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
			action.setImage(generateCountdownSvg(secs, POLL_INTERVAL_MS / 1000));
		}
	}
}

// ─── Base quota action ────────────────────────────────────────────────────────

abstract class QuotaAction<TSettings extends JsonObject> extends SingletonAction<TSettings> {
	constructor(private readonly provider: { check(action: KeyAction<TSettings>): Promise<void> }) {
		super();
	}

	override async onWillAppear(ev: WillAppearEvent<TSettings>): Promise<void> {
		const action = ev.action as KeyAction<TSettings>;
		const runner = () => this.provider.check(action);
		activeRunners.set(action.id, runner);
		await runner();
		startPolling(action.id, runner);
	}

	override async onWillDisappear(ev: WillDisappearEvent<TSettings>): Promise<void> {
		const interval = actionIntervals.get(ev.action.id);
		if (interval) {
			clearInterval(interval);
			actionIntervals.delete(ev.action.id);
		}
		activeRunners.delete(ev.action.id);
		lastPollTimestamps.delete(ev.action.id);
		latestDisplayValues.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<TSettings>): Promise<void> {
		const runner = activeRunners.get(ev.action.id);
		if (runner) {
			lastPollTimestamps.set(ev.action.id, Date.now());
			await runner();
		}
	}
}

// ─── Provider actions ─────────────────────────────────────────────────────────

@action({ UUID: "au.jkang.codingtoolquotachecker.action" })
export class CopilotAction extends QuotaAction<CopilotSettings> {
	constructor() { super(new CopilotProvider(updatePiDisplay)); }
}

@action({ UUID: "au.jkang.codingtoolquotachecker.claude" })
export class ClaudeUsageAction extends QuotaAction<ClaudeUsageSettings> {
	constructor() { super(new ClaudeUsageProvider(updatePiDisplay)); }
}

@action({ UUID: "au.jkang.codingtoolquotachecker.claudecredits" })
export class ClaudeCreditsAction extends QuotaAction<ClaudeCreditsSettings> {
	constructor() { super(new ClaudeCreditsProvider(updatePiDisplay)); }
}

@action({ UUID: "au.jkang.codingtoolquotachecker.antigravity" })
export class AntigravityAction extends QuotaAction<AntigravitySettings> {
	constructor() { super(new AntigravityProvider(updatePiDisplay)); }
}

@action({ UUID: "au.jkang.codingtoolquotachecker.openaicredits" })
export class OpenAiCreditsAction extends QuotaAction<OpenAiCreditsSettings> {
	constructor() { super(new OpenAiCreditsProvider(updatePiDisplay)); }
}

@action({ UUID: "au.jkang.codingtoolquotachecker.deepseek" })
export class DeepSeekAction extends QuotaAction<DeepSeekSettings> {
	constructor() { super(new DeepSeekProvider(updatePiDisplay)); }
}

@action({ UUID: "au.jkang.codingtoolquotachecker.fal" })
export class FalCreditsAction extends QuotaAction<FalCreditsSettings> {
	constructor() { super(new FalCreditsProvider(updatePiDisplay)); }
}

@action({ UUID: "au.jkang.codingtoolquotachecker.opencodego" })
export class OpenCodeGoAction extends QuotaAction<OpenCodeGoSettings> {
	constructor() { super(new OpenCodeGoProvider(updatePiDisplay)); }
}

// ─── Countdown action ─────────────────────────────────────────────────────────

@action({ UUID: "au.jkang.codingtoolquotachecker.countdown" })
export class CountdownAction extends SingletonAction<Record<string, never>> {
	override async onWillAppear(ev: WillAppearEvent<Record<string, never>>): Promise<void> {
		const action = ev.action as KeyAction<any>;
		const interval = setInterval(updateAllCountdowns, 1000);
		countdownActions.set(action.id, { action, interval });
		updateAllCountdowns();
	}

	override async onWillDisappear(ev: WillDisappearEvent<Record<string, never>>): Promise<void> {
		const entry = countdownActions.get(ev.action.id);
		if (entry) {
			clearInterval(entry.interval);
			countdownActions.delete(ev.action.id);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<Record<string, never>>): Promise<void> {
		for (const [id, runner] of activeRunners) {
			runner();
			startPolling(id, runner);
		}
		updateAllCountdowns();
	}
}
