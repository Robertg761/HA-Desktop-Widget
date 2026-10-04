# Contributing to HA Desktop Widget

Thank you for your interest in contributing to HA Desktop Widget! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites

- Node.js 20
- npm
- Git
- Windows 10/11, macOS 12+, or a current Linux desktop

### Development Setup

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/HA-Desktop-Widget.git
   cd HA-Desktop-Widget
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start development mode**:
   ```bash
   npm run dev
   ```

## 🎯 How to Contribute

### Reporting Issues

- **Bug Reports**: Use the [Issues](https://github.com/Robertg761/HA-Desktop-Widget/issues) page
- **Feature Requests**: Submit enhancement ideas with detailed descriptions
- **Security Issues**: Use GitHub private vulnerability reporting when available; otherwise follow [SECURITY.md](SECURITY.md) to contact the maintainer privately

### Making Changes

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes** following the coding standards below
3. **Test your changes** thoroughly
4. **Commit with a clear message**:
   ```bash
   git commit -m "Add: Brief description of your changes"
   ```
5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
6. **Create a Pull Request** with a detailed description

## 📝 Coding Standards

### JavaScript/Electron

- **ESLint**: Follow the existing ESLint configuration
- **Comments**: Add JSDoc comments for functions and complex logic
- **Naming**: Use camelCase for variables and functions, PascalCase for classes
- **Async/Await**: Prefer async/await over Promises when possible

### CSS/Styling

- **CSS Variables**: Use existing CSS custom properties for colors and spacing
- **Responsive**: Ensure styles work across different screen sizes
- **Performance**: Avoid expensive CSS properties in animations
- **Consistency**: Follow the existing design system

### Code Organization

- **Separation of Concerns**: Keep UI logic separate from business logic
- **Modularity**: Break large functions into smaller, focused functions
- **Error Handling**: Always include proper error handling and user feedback

### Dialogs, Focus and Toasts

- **Dialogs**: Open every dialog with `openDialog()` and close it with `closeDialog()` from `src/ui-utils.js`. They give you the role, focus trap, Escape and Enter handling, backdrop dismissal, stacking over other dialogs and focus return to whatever opened it. Do not add your own keydown or backdrop listener to a dialog.
- **Initial focus**: A dialog starts on its first control, not on the header's Close button. Use `initialFocus` (or `data-initial-focus`) for a different start, and `focusFallback` when the opener may be gone by the time the dialog closes.
- **Rebuilding the UI**: Wrap a re-render in `renderKeepingFocus()` and give controls a `data-focus-key` so focus survives it. Use `disableControlsKeepingFocus()` instead of setting `disabled` on a control that has focus.
- **Toasts**: Use `showToast()`. Errors stay until dismissed, repeats are folded into one toast, and a toast raised by a surface can be cleared with its `source` option and `dismissToasts()`.

### Language Packs

User-visible text goes through `t()` or `data-i18n`, and every new or changed string lives in `locales/en.json`, in each downloadable pack in `locale-packs/` (`ar`, `de`, `es`, `fr`, `hi`, `zh`) and in the bundled `locales/de.json`. A changed pack also needs a higher patch `version`, and `locale-packs/manifest.json` needs that version and the SHA-256 of the exact file bytes. `scripts/locale-packs.cjs` does the bookkeeping:

```bash
node scripts/locale-packs.cjs add strings.json   # {"Key": {"en": "...", "ar": "...", "de": "...", "es": "...", "fr": "...", "hi": "...", "zh": "..."}}
node scripts/locale-packs.cjs bump               # patch-bump every pack that changed, refresh the manifest
node scripts/locale-packs.cjs check              # keys, {{placeholders}}, no blank text, versions and hashes agree
```

`manifest` only refreshes the manifest (after a hand edit, say), and `check --against origin/main` also fails on a pack that changed without a version bump. Removing a string is different, see "Retiring strings" below. Packs are downloaded from `main`, so a translation only reaches users once it is merged and the manifest is current. Reuse the words a pack already uses for the same term and keep `{{placeholders}}` identical. A pack value that is still the English text fails the untranslated-string guard unless that language really writes the word that way.

**Retiring strings.** Every installed app downloads the packs from `main`, from the `minAppVersion` in the manifest up (3.4.1 today), merges them over its own bundled English and looks strings up by their English text. So a pack serves every release that can still install it, not just the one you are working on: delete a string from the packs and every older app silently shows English for it. Never delete a key from a pack by hand and do not raise `minAppVersion` to make a removal safe, which stops older apps installing any pack until they upgrade. Retire the key instead:

```bash
node scripts/locale-packs.cjs remove --in 4.0.0 --reason "Replaced by the new filter bar" "Old text"
```

`--in` is the release that ships the removal, the first one that no longer asks for the key. The key leaves `locales/en.json` and the bundled `locales/de.json`, so the app never shows it, and goes into `locale-packs/retired-keys.json` as `{retiredIn, reason}` (plus `en` when the English text was not the key itself, like the tray state names). The packs keep their translations, so they hold the current keys plus the retired ones, and a retirement alone changes no pack and needs no version bump. Retire a key whenever a release has shipped it and the code stops using it: that includes rewording a string, because the reworded text is a new key and the old one is retired. `check` accepts a pack key that is current or retired, and fails on any other extra key, on a retired key that is also current and on a retired key missing from a pack. If the text comes back, `add` it again with every language: that takes it off the retired list.

A retired key may be purged with `remove --purge <key>...` once `minAppVersion` of every pack, in the manifest and in the pack file, has been raised to the `retiredIn` release or later, because nothing that can install a pack uses the key any more. The tool refuses sooner, and a purge also deletes the translations. `--purge` on a current key skips all that, for text that was never released. `tests/fixtures/locale-pack-released-keys.json` lists the keys of each stable release the packs still serve, and a test fails when any pack lacks one of them. Add the new release to it when you cut a stable release (`git show vX.Y.Z:locales/en.json`), and drop a release only after raising `minAppVersion` past it.

**Merge conflicts in the packs.** Two branches that add strings both append to the end of every catalog, so they always conflict. Do not resolve those files by hand. Keep both sides' keys and let the tool redo the bookkeeping:

```bash
git merge origin/main                                   # conflicts in locales/ and locale-packs/
node scripts/locale-packs.cjs export "$(git merge-base HEAD MERGE_HEAD)" > /tmp/my-strings.json
git checkout MERGE_HEAD -- locales locale-packs         # take main's catalogs wholesale
node scripts/locale-packs.cjs add /tmp/my-strings.json  # put your keys back on top
node scripts/locale-packs.cjs bump --against MERGE_HEAD # one version above main's
node scripts/locale-packs.cjs check --against MERGE_HEAD
git add locales locale-packs
```

`export` lists only the texts your branch changed: every language of a key you added, and just the languages you edited for a key that already existed. A language only main touched keeps main's newer text. If both branches reworded the same language of the same key, yours replaces main's, so look at `git diff MERGE_HEAD -- locale-packs` before you commit.

`export` cannot say "deleted", so a key you retired comes back with main's catalogs. If your branch retired any, run `node scripts/locale-packs.cjs remove --in <version> --reason "<why>" <key>...` again after the `add` step and before `bump`, which puts it back on the retired list with its translations. If main retired the key as well, skip it: `remove` stops with "Already retired". In the other direction, if main retired a key your branch edited, `add` stops with `missing` for that key and writes nothing. To keep the key, give its entry `en` and every language, which also takes it off the retired list; to accept main's retirement, delete its entry from the exported file. Then run `add` again.

## 🧪 Testing

### Manual Testing

- Test all new features thoroughly
- Verify existing functionality still works
- Test on each operating system affected by the change when possible
- Treat Wayland/X11, native-window, tray, global-shortcut, and updater behavior as platform-specific
- Check performance with various numbers of entities

### Automated Testing

- Run the existing test suite:
  ```bash
  npm test
  ```
- Add tests for new features when appropriate
- Ensure all tests pass before submitting

## 📋 Pull Request Guidelines

### Before Submitting

- [ ] Code follows the project's coding standards
- [ ] All tests pass
- [ ] New features are documented
- [ ] No console errors or warnings
- [ ] Performance impact is considered

### PR Description Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Tested on every platform affected by the change
- [ ] Platform-specific limitations or untested environments are documented
- [ ] All existing functionality works
- [ ] New features tested thoroughly

## Screenshots (if applicable)

Add screenshots to help explain your changes

## Additional Notes

Any additional information about the changes
```

## 🏗️ Project Structure

```
HA-Desktop-Widget/
├── main.js              # Electron main process
├── renderer.js          # Renderer process (main UI logic)
├── index.html           # Main HTML file
├── styles.css           # Main stylesheet
├── package.json         # Project configuration
├── src/                 # Modular source files
│   ├── state.js         # Centralized state management
│   ├── websocket.js     # Home Assistant WebSocket connection
│   ├── ui.js            # UI rendering and interactions
│   ├── settings.js      # Settings modal
│   └── ...              # Other modules
├── tests/               # Test files
└── dist/                # Build output (generated)
```

## 🎨 Design Guidelines

### UI/UX Principles

- **Consistency**: Follow the existing design patterns
- **Accessibility**: Ensure good contrast and readable text
- **Performance**: Optimize for smooth animations and quick responses
- **User-Friendly**: Make features intuitive and easy to discover

### Visual Design

- **Rainmeter Aesthetic**: Clean, minimal, transparent design
- **Color Scheme**: Use the existing CSS custom properties
- **Typography**: Maintain consistent font sizes and weights
- **Spacing**: Follow the existing spacing system

## 🐛 Bug Fixes

### Common Issues

- **Connection Problems**: Check WebSocket handling and error states
- **UI Glitches**: Verify CSS and DOM manipulation
- **Performance**: Monitor memory usage and rendering performance
- **Cross-Platform**: Ensure Windows-specific features work correctly

### Debugging Tips

- Use `console.log()` for debugging (remove before submitting)
- Check the Electron DevTools for errors
- Test with different Home Assistant configurations
- Verify WebSocket message handling

## 📚 Resources

### Documentation

- [Electron Documentation](https://electronjs.org/docs)
- [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket)
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)

### Tools

- **Development**: VS Code with Electron extensions
- **Testing**: Jest for unit tests
- **Linting**: ESLint for code quality
- **Building**: electron-builder for packaging

## 🤝 Community Guidelines

### Be Respectful

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Accept constructive criticism gracefully
- Focus on what is best for the community

### Communication

- Keep discussions focused on the project
- Provide clear, constructive feedback
- Ask questions when you need help
- Share knowledge and help others learn

## 📞 Getting Help

- **GitHub Issues**: For bug reports and feature requests
- **Discussions**: For general questions and community chat
- **Email**: For security issues or private matters

## 🎉 Recognition

Contributors will be recognized in:

- The project's README.md
- Release notes for significant contributions
- GitHub's contributor graph

Thank you for contributing to HA Desktop Widget! 🚀
