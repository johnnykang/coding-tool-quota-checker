import streamDeck from "@elgato/streamdeck";

import {
	AntigravityAction,
	ClaudeCreditsAction,
	ClaudeUsageAction,
	CopilotAction,
	CountdownAction,
	DeepSeekAction,
	FalCreditsAction,
	OpenAiCreditsAction,
	OpenCodeGoAction,
	latestDisplayValues
} from "./actions";
import { encryptDpapi, isDpapiEncrypted } from "./dpapi";

streamDeck.logger.setLevel("info");
streamDeck.settings.useExperimentalMessageIdentifiers = true;

// Register all actions before connecting.
streamDeck.actions.registerAction(new CopilotAction());
streamDeck.actions.registerAction(new ClaudeUsageAction());
streamDeck.actions.registerAction(new ClaudeCreditsAction());
streamDeck.actions.registerAction(new AntigravityAction());
streamDeck.actions.registerAction(new OpenAiCreditsAction());
streamDeck.actions.registerAction(new DeepSeekAction());
streamDeck.actions.registerAction(new FalCreditsAction());
streamDeck.actions.registerAction(new OpenCodeGoAction());
streamDeck.actions.registerAction(new CountdownAction());

// ─── PI display state ─────────────────────────────────────────────────────────

streamDeck.ui.onDidAppear((ev) => {
	const val = latestDisplayValues.get(ev.action.id);
	if (val && streamDeck.ui.action?.id === ev.action.id) {
		streamDeck.ui.sendToPropertyInspector({
			type: "updateDisplay",
			value: val
		});
	}
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
		if (streamDeck.ui.action) {
			streamDeck.ui.sendToPropertyInspector({ type: "secretStatus", status });
		}
		return;
	}
});

// Connect last — always.
streamDeck.connect();
