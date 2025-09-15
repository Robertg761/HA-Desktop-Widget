# Security Policy

## Supported Versions

We provide security updates for the following versions of HA Desktop Widget:

| Version | Supported          |
| ------- | ------------------ |
| 2.2.x   | :white_check_mark: |
| 2.1.x   | :white_check_mark: |
| 2.0.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these steps:

### 1. Do NOT create a public issue
Security vulnerabilities should be reported privately to avoid exposing users to potential risks.

### 2. Email the maintainer
Send an email to the repository maintainer with the following information:
- **Subject**: `[SECURITY] HA Desktop Widget Vulnerability Report`
- **Description**: Detailed description of the vulnerability
- **Steps to reproduce**: Clear steps to reproduce the issue
- **Impact**: Potential impact and affected systems
- **Suggested fix**: If you have ideas for fixing the issue

### 3. Response timeline
- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix development**: Within 2-4 weeks (depending on severity)
- **Public disclosure**: After fix is released and users have had time to update

### 4. What to expect
- We will acknowledge receipt of your report
- We will investigate and assess the vulnerability
- We will work on a fix and coordinate with you
- We will release a security update
- We will publicly acknowledge your contribution (if desired)

## Security Best Practices

### For Users
- **Keep the app updated**: Always use the latest version
- **Secure your Home Assistant**: Use strong passwords and enable 2FA
- **Network security**: Use HTTPS for Home Assistant when possible
- **Token management**: Regularly rotate your long-lived access tokens
- **Firewall**: Configure your firewall to restrict access to Home Assistant

### For Developers
- **Dependency updates**: Keep all dependencies up to date
- **Code review**: All code changes are reviewed for security implications
- **Input validation**: All user inputs are validated and sanitized
- **Error handling**: Sensitive information is not exposed in error messages
- **Token storage**: Access tokens are stored securely and never logged

## Security Features

### Data Protection
- **Local storage**: All configuration data is stored locally on your device
- **No cloud sync**: The app does not send data to external servers
- **Token encryption**: Access tokens are stored securely in the OS keychain when possible
- **Memory protection**: Sensitive data is cleared from memory when no longer needed

### Network Security
- **HTTPS support**: Full support for HTTPS connections to Home Assistant
- **Certificate validation**: Proper SSL/TLS certificate validation
- **WebSocket security**: Secure WebSocket connections with proper authentication
- **No external requests**: The app only communicates with your Home Assistant instance

### Application Security
- **Code signing**: Windows builds are code-signed for authenticity
- **Auto-updates**: Secure update mechanism with signature verification
- **Sandboxing**: Electron security best practices are followed
- **Input sanitization**: All user inputs are properly sanitized

## Known Security Considerations

### Home Assistant Integration
- **Token exposure**: Long-lived access tokens are required for functionality
- **Network access**: The app needs network access to communicate with Home Assistant
- **Local storage**: Configuration is stored in the OS user data directory

### Electron Framework
- **Node.js integration**: Electron apps have access to Node.js APIs
- **Renderer process**: The renderer process runs with elevated privileges
- **Auto-updater**: The auto-updater downloads and installs updates automatically

## Security Updates

Security updates are released as:
- **Patch releases**: For critical security fixes (e.g., 2.2.1)
- **Minor releases**: For important security improvements (e.g., 2.3.0)
- **Major releases**: For significant security architecture changes (e.g., 3.0.0)

## Contact Information

For security-related issues, please contact:
- **Email**: [Maintainer email - to be added]
- **GitHub**: [@Robertg761](https://github.com/Robertg761)

## Acknowledgments

We thank the security researchers and community members who help keep HA Desktop Widget secure by responsibly reporting vulnerabilities.

---

**Last updated**: September 2024
**Next review**: December 2024
