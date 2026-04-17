# Copilot & Claude Quota Checker

![Screenshot](images/screenshot.png)

A Stream Deck plugin to seamlessly monitor your GitHub Copilot premium interactions quota and Anthropic Claude Code usage directly from your Elgato Stream Deck.

## Features

*   **Copilot Quota:** Displays the remaining premium requests/interactions for GitHub Copilot.
*   **Claude Code Usage:** Displays your Claude Code or claude.ai usage percentage based on different time windows and models.

## Installation

1.  Clone this repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Build the plugin:
    ```bash
    npm run build
    ```
4.  Link the plugin to the Stream Deck:
    ```bash
    node_modules\.bin\streamdeck.cmd link au.jkang.codingtoolquotachecker.sdPlugin
    ```
5.  Restart the Stream Deck application.

## Configuration

To use the plugin, drag one of the actions onto your Stream Deck and configure it using the Property Inspector.

### Copilot Quota

*   **GitHub Copilot Auth Token:** Your GitHub authorization token (e.g., `ghu_...`). This token requires access to the internal Copilot user API. Because this is an undocumented internal API, a standard Personal Access Token (PAT) will not work.
    *   **Requirements:** You need a GitHub User token (`ghu_...`) and an active GitHub Copilot subscription. The token needs at least the `read:user` scope.
    *   **How to get it:** The easiest way to obtain a working `ghu_` token is to log into GitHub Copilot in your IDE (like VS Code or JetBrains) and extract the token from the extension's logs or configuration files (e.g., `apps.json` or `github-copilot.xml`), as they handle the internal authentication exchange for you.

### Claude Code Usage

*   **Session Key:** Your Anthropic session key. You can find this by logging into `claude.ai`, opening your browser's Developer Tools, inspecting the Cookies, and copying the value of the `sessionKey` cookie (it typically starts with `sk-ant-sid01-...`).
*   **Organisation ID:** Your Anthropic Organisation ID. You can find this at [claude.ai/settings/account](https://claude.ai/settings/account) under the Organisation ID section.
*   **Usage Window:** Select the time period and model pool you want to monitor:
    *   `5-hour` (all models)
    *   `7-day` (all models)
    *   `7-day-sonnet` (7-day Sonnet)
    *   `7-day-omelette` (7-day Omelette - specific to Claude Code)
