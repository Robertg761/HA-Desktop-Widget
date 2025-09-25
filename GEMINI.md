# GEMINI.md - Project Overview

## Project Overview

This project is a desktop widget for Home Assistant, built with Electron. It provides a semi-transparent, always-on-top interface for quick access to smart home devices. The application connects to a Home Assistant instance via its WebSocket API for real-time entity updates.

**Key Technologies:**

*   **Framework:** Electron
*   **Languages:** JavaScript, HTML, CSS
*   **Main Dependencies:**
    *   `electron-builder`: For creating distributable packages.
    *   `electron-updater`: For automatic updates.
    *   `axios`: For HTTP requests.
    *   `hls.js`: For streaming camera feeds.
    *   `chart.js`: For displaying historical data.
    *   `jest`: For testing.
    *   `eslint`: For linting.
    *   `prettier`: For code formatting.

**Architecture:**

*   **Main Process (`main.js`):** Handles the application lifecycle, window management, system tray integration, configuration, and background tasks like auto-updates. It communicates with the renderer process via IPC.
*   **Renderer Process (`renderer-final.js`):** Manages the user interface, WebSocket connection to Home Assistant, and all user interactions. It receives data from the main process and updates the UI accordingly.
*   **UI (`index.html`, `styles.css`):** Defines the structure and styling of the widget.

## Building and Running

**Prerequisites:**

*   Node.js and npm

**Installation:**

```bash
npm install
```

**Running the application:**

*   **Development mode:**
    ```bash
    npm start
    ```
    or for dev tools open on start:
    ```bash
    npm run dev
    ```

*   **Building for distribution:**
    ```bash
    npm run dist
    ```

**Testing:**

```bash
npm test
```

**Linting and Formatting:**

*   **Lint:**
    ```bash
    npm run lint
    ```
*   **Fix linting errors:**
    ```bash
    npm run lint:fix
    ```
*   **Format code:**
    ```bash
    npm run format
    ```

## Development Conventions

*   **Code Style:** The project uses ESLint and Prettier to enforce a consistent code style. The configuration can be found in `.eslintrc.json`, `eslint.config.js` and `.prettierrc`.
*   **Testing:** Tests are written with Jest and are located in the `tests/` directory. The configuration is in `jest.config.js`.
*   **Configuration:** Application configuration is stored in `config.json` in the user's data directory (`%AppData%/Home Assistant Widget/`).
*   **Dependencies:** Project dependencies are managed in `package.json`.
*   **Contributing:** Contribution guidelines are outlined in `CONTRIBUTING.md`.
