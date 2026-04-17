# Agent Information

This repository contains an Elgato Stream Deck plugin written in TypeScript. It provides actions to monitor GitHub Copilot and Anthropic Claude quotas.

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

## Important Notes for AI Agents

*   The plugin dynamically generates SVG strings and sends them to the Stream Deck software via `action.setImage()`. Do not rely on static image assets for dynamic numbers.
*   The `sessionKey` for Claude acts as a direct cookie bypass. Do not expose or log this key.
*   Use Australian English spelling in all written output.
