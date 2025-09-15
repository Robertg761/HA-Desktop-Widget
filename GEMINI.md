# Project: Home Assistant Desktop Widget

## Project Overview

This project is a desktop widget for Home Assistant, built with Electron. It provides a transparent, always-on-top window to quickly access and control Home Assistant entities. The application uses a WebSocket connection to receive real-time updates from the Home Assistant server.

The frontend is built with vanilla JavaScript, HTML, and CSS. It dynamically renders different tabs for various Home Assistant domains like scenes, automations, media players, cameras, and more. The UI is interactive, with features like drag-and-drop for dashboard customization.

The main process, handled by `main.js`, is responsible for creating and managing the application window, tray icon, and handling system-level interactions like auto-updates. It also manages the application's configuration, which is stored in a `config.json` file.

The renderer process, primarily in `renderer-final.js`, handles the UI, WebSocket communication with the Home Assistant server, and all the logic for displaying and interacting with entities.

## Building and Running

### Prerequisites

- Node.js and npm

### Installation

To install the dependencies, run:

```bash
npm install
```

### Running the Application

To run the application in development mode, use:

```bash
npm start
```

This will launch the application with developer tools enabled.

### Building for Distribution

To build the application for Windows, you can use the following commands:

- To create an NSIS installer:

  ```bash
  npm run dist:win
  ```

- To create both an NSIS installer and a portable executable:

  ```bash
  npm run dist
  ```

The build artifacts will be located in the `dist/` directory.

### Testing

The project uses Jest for testing. To run the tests, use:

```bash
npm test
```

### Linting

The project uses ESLint for linting. To check for linting errors, run:

```bash
npm run lint
```

To automatically fix linting errors, use:

```bash
npm run lint:fix
```

## Development Conventions

- **Code Style:** The project uses Prettier for code formatting. It's recommended to format the code before committing.
- **Linting:** ESLint is used to enforce code quality and style. The configuration can be found in `.eslintrc.json`.
- **Testing:** Tests are located in the `tests/` directory and are written using Jest.
- **Dependencies:** Project dependencies are managed using npm and are listed in the `package.json` file.
- **Configuration:** The application's configuration is stored in a `config.json` file in the user's data directory. This file is ignored by Git to prevent committing sensitive information like access tokens.
