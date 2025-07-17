# Copilot Instructions for DayZ Server Manager

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Project Overview
This is an Electron application for managing DayZ game servers. The application provides:

- Multiple server instance management
- Automatic mod updating via SteamCMD
- Server file synchronization
- Backup management
- Real-time server monitoring
- Configuration management

## Technical Stack
- **Framework**: Electron (Node.js + Chromium)
- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js with child_process for external commands
- **File Operations**: fs-extra for enhanced file system operations
- **Scheduling**: node-cron for automated tasks

## Key Features to Implement
1. **Server Configuration**: Store and manage multiple server configurations
2. **SteamCMD Integration**: Execute SteamCMD commands for mod updates and server files
3. **Mod Management**: Parse mod lists, download, and sync mods
4. **Backup System**: Automated backup of server data with configurable retention
5. **Process Management**: Start, stop, and monitor server processes
6. **Log Management**: Display and manage server logs
7. **Real-time Status**: Monitor server status and player count

## Code Conventions
- Use modern JavaScript (ES6+) features
- Implement proper error handling for all file and process operations
- Use async/await for asynchronous operations
- Modular architecture with separate files for different functionalities
- Consistent naming conventions for variables and functions

## Security Considerations
- Validate all user inputs, especially file paths
- Secure storage of Steam credentials
- Proper process isolation for server operations
- Safe handling of configuration files

## Windows-Specific Notes
- Use proper Windows path handling
- Consider PowerShell execution policies
- Handle Windows service management if needed
- Account for Windows file locking issues
