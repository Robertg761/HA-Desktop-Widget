# Contributing to HA Desktop Widget

Thank you for your interest in contributing to HA Desktop Widget! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Git
- Windows 10/11 (for testing)

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
   npm start
   ```

## 🎯 How to Contribute

### Reporting Issues
- **Bug Reports**: Use the [Issues](https://github.com/Robertg761/HA-Desktop-Widget/issues) page
- **Feature Requests**: Submit enhancement ideas with detailed descriptions
- **Security Issues**: Please email security concerns directly to the maintainer

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

## 🧪 Testing

### Manual Testing
- Test all new features thoroughly
- Verify existing functionality still works
- Test on different Windows versions if possible
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
- [ ] Tested on Windows 10/11
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
├── renderer-final.js    # Renderer process (main UI logic)
├── keyboard.js          # Keyboard shortcut handling
├── index.html           # Main HTML file
├── styles.css           # Main stylesheet
├── package.json         # Project configuration
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
