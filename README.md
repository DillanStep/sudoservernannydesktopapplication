# DayZ Server Manager

A comprehensive Electron application for managing DayZ game servers with automatic mod updating, backup management, real-time monitoring, and auto-update functionality.

## Features

### 🖥️ Server Management
- **Multiple Server Instances**: Manage unlimited DayZ server instances from a single interface
- **Real-time Monitoring**: Monitor server status, player count, and performance metrics
- **One-Click Operations**: Start, stop, restart servers with simple button clicks
- **Configuration Management**: Store and manage server configurations with easy editing

### 🔧 Mod Management
- **SteamCMD Integration**: Automatic mod downloading and updating via SteamCMD
- **Steam Web API Integration**: Fetch detailed mod information using Steam Web API
- **Startup Mod Checking**: Automatically check for mod updates when the application starts
- **Batch Operations**: Update all mods across all servers simultaneously
- **Mod Synchronization**: Sync workshop mods to server directories automatically
- **Key Management**: Automatic bikey copying to server keys directory

### 🔄 Auto-Updates
- **Automatic Updates**: App automatically checks for and installs updates
- **GitHub Releases**: Seamless updates via GitHub releases
- **Progress Tracking**: Real-time download progress with user notifications
- **Multi-Device Sync**: Keep all your devices updated with the latest version

### 💾 Backup System
- **Automated Backups**: Schedule automatic backups of server data
- **Configurable Retention**: Set backup retention policies (days to keep)
- **Quick Restore**: Easy backup restoration with point-and-click interface
- **Data Protection**: Backup player databases, logs, and mission files

### 📊 Monitoring & Logs
- **Real-time Logs**: View server logs in real-time with filtering options
- **Error Tracking**: Monitor and track server errors and warnings
- **Performance Metrics**: Track server performance and resource usage
- **Console Access**: Direct SteamCMD console access for advanced operations

## Prerequisites

Before running DayZ Server Manager, ensure you have:

1. **Node.js** (v16 or higher)
2. **SteamCMD** installed and configured
3. **DayZ Server files** downloaded via SteamCMD
4. **Windows OS** (Currently Windows-focused, Linux support planned)

## Installation

1. **Clone or download** this repository
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure SteamCMD path** in application settings
4. **Start the application**:
   ```bash
   npm start
   ```

## GitHub Setup for Auto-Updates

To enable auto-updates across your devices, you'll need to set up a GitHub repository:

### 1. Create GitHub Repository
1. Create a new **public** repository on GitHub (e.g., `dillanstep/dayz-server-manager`)
2. Update the repository URLs in `package.json`:
   ```json
   "repository": {
     "type": "git",
     "url": "https://github.com/dillanstep/dayz-server-manager.git"
   },
   "publish": [
     {
       "provider": "github",
       "owner": "dillanstep",
       "repo": "dayz-server-manager"
     }
   ]
   ```

### 2. Set Up Repository
1. **Initialize git** in your project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/dillanstep/dayz-server-manager.git
   git push -u origin main
   ```

### 3. Release New Versions
To publish updates that all your devices can automatically install:

1. **Update version** and push changes:
   ```bash
   git add .
   git commit -m "Your changes description"
   npm run release        # Increments patch version (1.0.0 → 1.0.1)
   # OR
   npm run release:minor  # Increments minor version (1.0.0 → 1.1.0)
   # OR
   npm run release:major  # Increments major version (1.0.0 → 2.0.0)
   ```

2. **GitHub Actions** will automatically:
   - Build the application
   - Create a new release
   - Upload installer files
   - Make the update available to all devices

### 4. How Auto-Updates Work
- App **automatically checks** for updates on startup
- Users get **notification modals** when updates are available
- **Progress tracking** during download and installation
- **Seamless updates** across all your devices

## Quick Start Guide

### 1. Initial Setup
1. Launch the application
2. Click the **Settings** button in the header
3. Configure your **SteamCMD path** and **Workshop path**
4. Set up **backup retention** and **auto-update schedules**
5. Save settings

### 2. Add Your First Server
1. Click **"Add Server"** in the main interface
2. Fill in server details:
   - **Server Name**: Give your server a descriptive name
   - **Instance ID**: Unique identifier for this server instance
   - **Server Path**: Path to your DayZ server installation
   - **Port**: Server port (default: 2302)
   - **Profile Name**: Server profile directory name
   - **Config File**: Server configuration file name

3. Configure mods (optional):
   - Add mod IDs in the format: `ModID,FolderName`
   - Example: `1559212036,CF`

4. Set up Steam credentials for mod downloading
5. Configure backup path
6. Save the server configuration

### 3. Server Operations
- **Start Server**: Click the green "Start" button on any server card
- **Stop Server**: Click the red "Stop" button for running servers
- **Update Mods**: Click "Update" to download latest mod versions
- **Create Backup**: Click "Backup" to create an immediate backup
- **Edit Configuration**: Click "Edit" to modify server settings

## Configuration

### Server Configuration
Each server requires the following configuration:

```json
{
  "name": "My DayZ Server",
  "instanceId": 1,
  "serverPath": "C:\\DayZServer",
  "port": 2302,
  "profileName": "ServerProfile",
  "configFile": "serverDZ.cfg",
  "steamUsername": "your_steam_username",
  "steamPassword": "your_steam_password",
  "mods": [
    { "id": "1559212036", "folderName": "CF" },
    { "id": "1565871491", "folderName": "BuilderItems" }
  ],
  "cpuCount": 4,
  "backupPath": "C:\\Backups"
}
```

### Application Settings
Global application settings include:

```json
{
  "steamCmdPath": "C:\\SteamCMD",
  "workshopPath": "C:\\SteamCMD\\steamapps\\workshop\\content\\221100",
  "backupRetentionDays": 5,
  "autoBackup": true,
  "autoModUpdate": true,
  "updateInterval": "0 4 * * *"
}
```

## Mod List Format

The mod list should be formatted as comma-separated values:
```
ModID,FolderName
1559212036,CF
1565871491,BuilderItems
1646187754,BaseBuildingPlus
```

Where:
- **ModID**: The Steam Workshop mod ID
- **FolderName**: The desired folder name in your server's mod directory

## Backup System

The backup system automatically creates timestamped backups including:
- Player database files (`.db`)
- Mission data files (`.bin`, `.001`, `.002`)
- Server logs (`.log`, `.rpt`, `.adm`)
- Configuration files

Backups are organized by:
```
BackupPath/
├── ServerProfile1/
│   ├── 20240117_0400_00/
│   ├── 20240118_0400_00/
│   └── ...
└── ServerProfile2/
    ├── 20240117_0400_00/
    └── ...
```

## SteamCMD Integration

The application integrates with SteamCMD to:
1. **Download server files** for DayZ (App ID: 223350)
2. **Download workshop mods** (App ID: 221100)
3. **Update existing installations**
4. **Verify file integrity**

### Required SteamCMD Setup
1. Download SteamCMD from Valve
2. Extract to a dedicated directory (e.g., `C:\\SteamCMD`)
3. Run initial setup: `steamcmd.exe +quit`
4. Configure the path in application settings

## Troubleshooting

### Common Issues

**Server won't start:**
- Verify server path is correct
- Check that DayZ server files are present
- Ensure port is not already in use
- Validate configuration file syntax

**Mods not downloading:**
- Verify Steam credentials are correct
- Check SteamCMD path configuration
- Ensure internet connectivity
- Verify mod IDs are valid

**Backups failing:**
- Check backup path permissions
- Verify sufficient disk space
- Ensure server files are not locked

### Log Files
Application logs are stored in:
- **Windows**: `%APPDATA%\\DayZ Server Manager\\logs\\`
- **Console output**: Available in the application's Console tab

## Development

### Building from Source
```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

### Project Structure
```
DayZ Server Manager/
├── main.js                 # Main Electron process
├── src/
│   └── renderer/
│       ├── index.html      # Main UI
│       ├── styles.css      # Application styles
│       └── renderer.js     # Renderer process logic
├── config/                 # Configuration files
├── .github/
│   └── copilot-instructions.md
└── package.json
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Create an issue on GitHub
- Check the troubleshooting section above
- Review application logs for error details

## Roadmap

### Planned Features
- [ ] Linux support
- [ ] Remote server management
- [ ] Player management interface
- [ ] Advanced monitoring and alerting
- [ ] Plugin system for extensions
- [ ] Multi-language support
- [ ] Cloud backup integration
- [ ] Performance optimization tools

---

**Note**: This application is designed to work with the current batch scripts you're using. It provides a modern, user-friendly interface while maintaining all the functionality of your existing server management setup.

