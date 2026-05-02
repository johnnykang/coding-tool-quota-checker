import { KeyAction } from "@elgato/streamdeck";
import { JsonObject } from "@elgato/utils";

/**
 * Contract that every quota provider must satisfy.
 *
 * `TSettings` must extend `JsonObject` to satisfy the Stream Deck SDK's
 * constraint on `KeyAction<T>` (settings are persisted as JSON).
 */
export interface IQuotaProvider<TSettings extends JsonObject> {
    /** Fetch fresh data and update the key image. */
    check(action: KeyAction<TSettings>): Promise<void>;
}

/**
 * Callback signature used to push display values into the Property Inspector.
 */
export type PiDisplayUpdater = (action: KeyAction<any>, displayValue: string) => void;
