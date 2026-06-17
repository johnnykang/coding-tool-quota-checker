# Agent Information

This repository contains an Elgato Stream Deck plugin written in TypeScript. It provides actions to monitor GitHub Copilot, Anthropic Claude, Antigravity, and OpenAI quotas and credit balances.

## Tech Stack

*   **Language:** TypeScript
*   **SDK:** `@elgato/streamdeck` (v2)
*   **Bundler:** Rollup
*   **Platform:** Node.js (for build tools)

## Commands

*   `npm run build`: Compiles the TypeScript source via Rollup into the `.sdPlugin/bin` directory.
*   `npm run watch`: Runs the Rollup compiler in watch mode.

## Architecture & Files

*   `src/plugin.ts`: The main controller. It handles Stream Deck events (`onWillAppear`, `onWillDisappear`, `onKeyDown`), polls the respective APIs on a 5-minute interval, and updates the key images.
*   `src/svg.ts`: Contains helper functions to dynamically generate SVGs for the Stream Deck buttons (e.g., displaying counts, percentages, or error messages).
*   `au.jkang.codingtoolquotachecker.sdPlugin/manifest.json`: The standard Stream Deck plugin manifest.
*   `au.jkang.codingtoolquotachecker.sdPlugin/pi.html`: The Property Inspector for the **Copilot Quota** action. Handles saving the `authToken`.
*   `au.jkang.codingtoolquotachecker.sdPlugin/pi-claude.html`: The Property Inspector for the **Claude Code Usage** action. Handles saving the `sessionKey`, `organizationId`, and `usagePeriod`.
*   `au.jkang.codingtoolquotachecker.sdPlugin/pi-claude-credits.html`: The Property Inspector for the **Claude API Credits** action. Handles saving the `apiKey` and `organizationId`.
*   `au.jkang.codingtoolquotachecker.sdPlugin/pi-antigravity.html`: The Property Inspector for the **Antigravity Quota** action. Handles saving the `modelLabel`.
*   `au.jkang.codingtoolquotachecker.sdPlugin/pi-openai-credits.html`: The Property Inspector for the **OpenAI Credits** action. Handles saving the `sessionToken`.
*   `au.jkang.codingtoolquotachecker.sdPlugin/pi-deepseek.html`: The Property Inspector for the **DeepSeek Balance** action. Handles saving the `apiKey`.
*   `au.jkang.codingtoolquotachecker.sdPlugin/pi-fal-credits.html`: The Property Inspector for the **FAL.AI Balance** action. Handles saving the `apiKey`.

## Important Notes for AI Agents

*   The plugin dynamically generates SVG strings and sends them to the Stream Deck software via `action.setImage()`. Do not rely on static image assets for dynamic numbers.
*   The `sessionKey` (Claude) and `sessionToken` (OpenAI) act as direct cookie/session bypasses. Do not expose or log these values.
*   Use Australian English spelling in all written output.
*   When a new provider or action is added, update `README.md` to include it in the introduction paragraph, the Features list, and add a dedicated Configuration section.
