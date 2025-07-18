const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process');
const cron = require('node-cron');
const fetch = require('node-fetch');
const pidusage = require('pidusage');
const BackupManager = require('./src/utils/BackupManager');
const ServerRConManager = require('./src/utils/ServerRConManager');
const BattlEyeManager = require('./src/utils/BattlEyeManager');

class DayZServerManager {
    constructor() {
        this.mainWindow = null;
        this.splashWindow = null;
        this.serverProcesses = new Map();
        
        // Use user data directory for configuration files when installed
        // This ensures configs are stored in a writable location
        this.configPath = app.isPackaged 
            ? path.join(app.getPath('userData'), 'config')
            : path.join(__dirname, 'config');
            
        this.serversConfigPath = path.join(this.configPath, 'servers.json');
        this.settingsConfigPath = path.join(this.configPath, 'settings.json');
        this.modVersionsConfigPath = path.join(this.configPath, 'mod-versions.json');
        this.monitoringIntervals = new Map(); // Store monitoring intervals
        this.restartSchedules = new Map(); // Store restart schedules and timers
        this.rconManager = new ServerRConManager(); // RCon management
        this.battleEyeManager = new BattlEyeManager(); // BattlEye management
        this.isTransitioning = false; // Flag to prevent duplicate window creation
        this.defaultSettings = {
            steamCmdPath: 'C:\\SteamCMD',
            workshopPath: 'C:\\SteamCMD\\steamapps\\workshop\\content\\221100',
            backupRetentionDays: 5,
            autoBackup: true,
            autoModUpdate: false, // Disabled by default to avoid rate limiting
            updateInterval: '0 4 * * *', // Daily at 4 AM
            steamWebApiKey: '8985B1B229AB632E4C54B68D2A226F07',
            checkModsOnStartup: false, // Disabled by default to avoid rate limiting
            steamUsername: '',
            steamPassword: '',
            updateModsBeforeServerStart: false,
            defaultModCopyPath: ''
        };
        // Don't initialize here - wait for app.whenReady()
    }

    createSplashWindow() {
        // Set up basic IPC handlers that splash screen needs immediately
        if (!ipcMain.listenerCount('get-app-version')) {
            ipcMain.handle('get-app-version', () => app.getVersion());
        }

        this.splashWindow = new BrowserWindow({
            width: 500,
            height: 350,
            frame: false,
            alwaysOnTop: true,
            transparent: true,
            resizable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        this.splashWindow.loadFile('src/renderer/splash.html');

        // Center the splash window
        this.splashWindow.center();

        this.splashWindow.on('closed', () => {
            this.splashWindow = null;
        });

        // Handle splash finished event
        ipcMain.once('splash-finished', () => {
            this.closeSplashAndShowMain();
        });

        return this.splashWindow;
    }

    async closeSplashAndShowMain() {
        if (this.isTransitioning || this.mainWindow) {
            return; // Prevent duplicate windows
        }
        
        this.isTransitioning = true;
        
        if (this.splashWindow) {
            this.splashWindow.close();
            this.splashWindow = null;
        }

        // Create and show main window
        this.createWindow();
        this.setupMenu();
        
        this.isTransitioning = false;
    }

    sendSplashProgress(progress, message) {
        if (this.splashWindow) {
            this.splashWindow.webContents.send('splash-progress', { progress, message });
        }
    }

    sendSplashComplete(message = 'Ready to launch!') {
        if (this.splashWindow) {
            this.splashWindow.webContents.send('splash-complete', { message });
        }
    }

    sendSplashError(message) {
        if (this.splashWindow) {
            this.splashWindow.webContents.send('splash-error', { message });
        }
    }

    setupAutoUpdater() {
        // Configure auto-updater
        autoUpdater.logger = console;
        autoUpdater.autoDownload = false; // Don't auto-download, ask user first
        autoUpdater.autoInstallOnAppQuit = true;

        // Add detailed logging for debugging
        console.log('=== AUTO-UPDATER DEBUG INFO ===');
        console.log('Current app version:', app.getVersion());
        console.log('App is packaged:', app.isPackaged);
        console.log('Feed URL:', autoUpdater.getFeedURL());
        console.log('==============================');

        // Auto-updater events
        autoUpdater.on('checking-for-update', () => {
            console.log('🔍 AUTO-UPDATER: Checking for update...');
            console.log('Current version:', app.getVersion());
            this.sendStatusToRenderer('Checking for updates...');
        });

        autoUpdater.on('update-available', (info) => {
            console.log('✅ AUTO-UPDATER: Update available!', info);
            console.log('Available version:', info.version);
            console.log('Current version:', app.getVersion());
            this.handleUpdateAvailable(info);
        });

        autoUpdater.on('update-not-available', (info) => {
            console.log('❌ AUTO-UPDATER: Update not available', info);
            console.log('Latest version:', info.version);
            console.log('Current version:', app.getVersion());
            this.sendStatusToRenderer('Application is up to date');
        });

        autoUpdater.on('error', (err) => {
            console.error('💥 AUTO-UPDATER ERROR:', err);
            console.log('Error details:', err.message);
            this.sendStatusToRenderer('No New Update Found, Up To date :)');
        });

        autoUpdater.on('download-progress', (progressObj) => {
            let log_message = `Download speed: ${progressObj.bytesPerSecond}`;
            log_message = log_message + ` - Downloaded ${progressObj.percent}%`;
            log_message = log_message + ` (${progressObj.transferred}/${progressObj.total})`;
            console.log(log_message);
            this.sendUpdateProgress(progressObj);
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('Update downloaded:', info);
            this.handleUpdateDownloaded(info);
        });

        // Check for updates on startup (after a delay)
        setTimeout(() => {
            if (process.env.NODE_ENV !== 'development') {
                autoUpdater.checkForUpdatesAndNotify();
            }
        }, 5000);
    }

    handleUpdateAvailable(info) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('update-available', {
                version: info.version,
                releaseNotes: info.releaseNotes,
                releaseDate: info.releaseDate
            });
        }
    }

    handleUpdateDownloaded(info) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('update-downloaded', {
                version: info.version
            });
            
            // Schedule server status refresh after a short delay
            // This ensures the renderer has time to process the update notification
            setTimeout(() => {
                console.log('🔄 Refreshing server statuses after update...');
                this.refreshAllServerStatuses();
            }, 2000);
        }
    }

    refreshAllServerStatuses() {
        try {
            console.log('🔄 Refreshing all server statuses...');
            
            // Send refresh signal to renderer
            if (this.mainWindow) {
                this.mainWindow.webContents.send('refresh-server-statuses');
            }
            
            // Also send current status for each server
            for (const server of this.servers) {
                const status = this.getServerStatus(server.id);
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('server-status-changed', { 
                        serverId: server.id, 
                        status: typeof status === 'object' ? status.status : status 
                    });
                }
            }
            
            console.log('✅ Server status refresh completed');
            return { success: true, refreshed: this.servers.length };
        } catch (error) {
            console.error('❌ Error refreshing server statuses:', error);
            return { success: false, error: error.message };
        }
    }

    sendStatusToRenderer(message) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('startup-status', message);
        }
    }

    sendUpdateProgress(progressObj) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('update-progress', progressObj);
        }
    }

    async initializeApp() {
        try {
            // Setup auto-updater first
            this.sendSplashProgress(10, 'Setting up auto-updater...');
            this.setupAutoUpdater();
            
            // Ensure config directory exists with better error handling
            this.sendSplashProgress(20, 'Creating configuration directories...');
            console.log('Config path:', this.configPath);
            
            try {
                await fs.ensureDir(this.configPath);
                console.log('Config directory created successfully');
            } catch (dirError) {
                console.error('Failed to create config directory:', dirError);
                throw new Error(`Cannot create config directory: ${dirError.message}`);
            }
            
            // Load or create default configurations
            this.sendSplashProgress(40, 'Loading configuration files...');
            await this.loadConfigurations();
            
            // Setup IPC handlers
            this.sendSplashProgress(70, 'Setting up IPC handlers...');
            this.setupIpcHandlers();
            
            // Final setup
            this.sendSplashProgress(90, 'Finalizing initialization...');
            
            // Small delay to show completion
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Signal completion
            this.sendSplashComplete('Initialization complete!');
            
        } catch (error) {
            console.error('Error during initialization:', error);
            this.sendSplashError(`Initialization failed: ${error.message}`);
        }
    }

    async loadConfigurations() {
        try {
            console.log('Loading configurations from:', this.configPath);
            
            // Load settings with better error handling
            try {
                if (await fs.pathExists(this.settingsConfigPath)) {
                    this.settings = await fs.readJson(this.settingsConfigPath);
                    console.log('Settings loaded successfully');
                } else {
                    console.log('Settings file not found, creating default settings');
                    this.settings = { ...this.defaultSettings };
                    await fs.writeJson(this.settingsConfigPath, this.settings, { spaces: 2 });
                    console.log('Default settings created');
                }
            } catch (settingsError) {
                console.error('Error with settings file:', settingsError);
                this.settings = { ...this.defaultSettings };
                try {
                    await fs.writeJson(this.settingsConfigPath, this.settings, { spaces: 2 });
                } catch (writeError) {
                    console.error('Failed to write default settings:', writeError);
                }
            }

            // Load servers with better error handling
            try {
                if (await fs.pathExists(this.serversConfigPath)) {
                    this.servers = await fs.readJson(this.serversConfigPath);
                    console.log('Servers configuration loaded successfully');
                    // Fix any servers with missing folder names
                    await this.fixServerConfigurations();
                } else {
                    console.log('Servers file not found, creating empty servers array');
                    this.servers = [];
                    await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
                    console.log('Empty servers configuration created');
                }
            } catch (serversError) {
                console.error('Error with servers file:', serversError);
                this.servers = [];
                try {
                    await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
                } catch (writeError) {
                    console.error('Failed to write default servers:', writeError);
                }
            }

            // Load mod versions with better error handling
            try {
                if (await fs.pathExists(this.modVersionsConfigPath)) {
                    this.modVersions = await fs.readJson(this.modVersionsConfigPath);
                    console.log('Mod versions loaded successfully');
                } else {
                    console.log('Mod versions file not found, creating empty object');
                    this.modVersions = {};
                    await fs.writeJson(this.modVersionsConfigPath, this.modVersions, { spaces: 2 });
                    console.log('Empty mod versions created');
                }
            } catch (modVersionsError) {
                console.error('Error with mod versions file:', modVersionsError);
                this.modVersions = {};
                try {
                    await fs.writeJson(this.modVersionsConfigPath, this.modVersions, { spaces: 2 });
                } catch (writeError) {
                    console.error('Failed to write default mod versions:', writeError);
                }
            }
            
            console.log('Configuration loading completed');
            
            // Initialize restart schedules for servers that have them
            this.initializeRestartSchedules();
            
            // Initialize RCon connections for servers
            await this.initializeRConConnections();
        } catch (error) {
            console.error('Error loading configurations:', error);
            throw error; // Re-throw so initialization can handle it
        }
    }

    initializeRestartSchedules() {
        console.log('🔄 Initializing restart schedules...');
        
        let scheduledCount = 0;
        for (const server of this.servers) {
            if (server.restartScheduler && server.restartScheduler.enabled) {
                console.log(`⏰ Restoring restart schedule for server ${server.name}`);
                this.setupRestartTimers(server.id, server.restartScheduler);
                scheduledCount++;
            }
        }
        
        console.log(`✅ Initialized ${scheduledCount} restart schedules`);
    }

    async fixServerConfigurations() {
        let needsSave = false;
        
        for (const server of this.servers) {
            // Fix empty profile names
            if (!server.profileName || server.profileName.trim() === '') {
                server.profileName = server.name ? server.name.replace(/[^a-zA-Z0-9]/g, '') : 'Server' + server.instanceId;
                needsSave = true;
                console.log(`Fixed profile name for server ${server.name}: ${server.profileName}`);
            }
            
            // Fix empty mod folder names
            if (server.mods && Array.isArray(server.mods)) {
                for (const mod of server.mods) {
                    if (mod.id && (!mod.folderName || mod.folderName.trim() === '')) {
                        mod.folderName = `@Mod_${mod.id}`;
                        needsSave = true;
                        console.log(`Fixed folder name for mod ${mod.id}: ${mod.folderName}`);
                    }
                }
            }
        }
        
        if (needsSave) {
            await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
            console.log('Server configurations have been fixed and saved');
        }
    }

    createWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            title: 'SUDO Server Nanny',
            icon: path.join(__dirname, 'assets', 'icon.ico')
        });

        // Set global reference for RCon manager
        global.mainWindow = this.mainWindow;

        this.mainWindow.loadFile('src/renderer/index.html');

        // When the window is ready, start initial checks
        this.mainWindow.webContents.once('dom-ready', async () => {
            if (this.settings && this.settings.checkModsOnStartup) {
                await this.performStartupChecks();
            }
            
            // Refresh server statuses when window is ready
            setTimeout(() => {
                console.log('🔄 Initial server status refresh...');
                this.refreshAllServerStatuses();
            }, 1000);
        });

        // Open DevTools in development
        if (process.env.NODE_ENV === 'development') {
            this.mainWindow.webContents.openDevTools();
        }

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        // Check for mod updates on startup
        this.mainWindow.webContents.once('did-finish-load', () => {
            // Only check for mod updates if settings are loaded
            if (this.settings && this.settings.checkModsOnStartup) {
                this.checkForModUpdatesOnStartup();
            }
            
            // Additional server status refresh after window fully loads
            setTimeout(() => {
                console.log('🔄 Post-load server status refresh...');
                this.refreshAllServerStatuses();
            }, 2000);
        });
    }

    setupMenu() {
        const template = [
            {
                label: 'File',
                submenu: [
                    {
                        label: 'New Server',
                        accelerator: 'CmdOrCtrl+N',
                        click: () => this.mainWindow.webContents.send('new-server')
                    },
                    {
                        label: 'Import Config',
                        click: async () => {
                            const result = await dialog.showOpenDialog(this.mainWindow, {
                                properties: ['openFile'],
                                filters: [{ name: 'JSON Files', extensions: ['json'] }]
                            });
                            if (!result.canceled) {
                                this.mainWindow.webContents.send('import-config', result.filePaths[0]);
                            }
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Exit',
                        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                        click: () => app.quit()
                    }
                ]
            },
            {
                label: 'Servers',
                submenu: [
                    {
                        label: 'Start All',
                        click: () => this.mainWindow.webContents.send('start-all-servers')
                    },
                    {
                        label: 'Stop All',
                        click: () => this.mainWindow.webContents.send('stop-all-servers')
                    },
                    {
                        label: 'Update All Mods',
                        click: () => this.mainWindow.webContents.send('update-all-mods')
                    },
                    {
                        label: 'Backup All',
                        click: () => this.mainWindow.webContents.send('backup-all-servers')
                    }
                ]
            },
            {
                label: 'Tools',
                submenu: [
                    {
                        label: 'Settings',
                        click: () => this.mainWindow.webContents.send('open-settings')
                    },
                    {
                        label: 'SteamCMD Console',
                        click: () => this.mainWindow.webContents.send('open-steamcmd-console')
                    },
                    {
                        label: 'Logs Viewer',
                        click: () => this.mainWindow.webContents.send('open-logs')
                    }
                ]
            },
            {
                label: 'Help',
                submenu: [
                    {
                        label: 'Check for Updates',
                        click: () => this.mainWindow.webContents.send('check-for-updates-manual')
                    },
                    { type: 'separator' },
                    {
                        label: 'About',
                        click: () => this.mainWindow.webContents.send('show-about')
                    },
                    {
                        label: 'Documentation',
                        click: () => shell.openExternal('https://github.com/your-repo/dayz-server-manager')
                    }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
    }

    setupIpcHandlers() {
        // Server management
        ipcMain.handle('get-servers', () => this.servers);
        ipcMain.handle('save-server', async (event, server) => await this.saveServer(server));
        ipcMain.handle('delete-server', async (event, serverId) => await this.deleteServer(serverId));
        ipcMain.handle('start-server', async (event, serverId) => await this.startServer(serverId));
        ipcMain.handle('stop-server', async (event, serverId) => await this.stopServer(serverId));
        ipcMain.handle('get-server-status', (event, serverId) => this.getServerStatus(serverId));
        ipcMain.handle('refresh-all-server-statuses', () => this.refreshAllServerStatuses());
        ipcMain.handle('set-server-restart-schedule', async (event, serverId, schedule) => await this.setServerRestartSchedule(serverId, schedule));
        ipcMain.handle('get-server-restart-schedule', (event, serverId) => this.getServerRestartSchedule(serverId));
        ipcMain.handle('clear-server-restart-schedule', async (event, serverId) => await this.clearServerRestartSchedule(serverId));

        // Mod management
        ipcMain.handle('update-mods', async (event, serverId) => await this.updateMods(serverId));
        ipcMain.handle('update-single-mod', async (event, modId) => await this.updateSingleMod(modId));
        ipcMain.handle('sync-mods', async (event, serverId) => await this.syncMods(serverId));
        ipcMain.handle('get-mod-info', async (event, modId) => await this.getModInfo(modId));
        ipcMain.handle('check-mod-updates', async (event, serverId) => await this.checkModUpdates(serverId));
        ipcMain.handle('check-mod-updates-available', async (event, serverId) => await this.checkModUpdatesAvailable(serverId));
        ipcMain.handle('search-workshop-mods', async (event, searchQuery, page = 1) => await this.searchWorkshopMods(searchQuery, page));
        ipcMain.handle('get-mod-changelog', async (event, modId) => await this.getModChangelog(modId));
        ipcMain.handle('add-mod-to-server', async (event, serverId, modData) => await this.addModToServer(serverId, modData));

        // Server configuration management
        ipcMain.handle('read-server-config', async (event, serverId) => await this.readServerConfig(serverId));
        ipcMain.handle('save-server-config', async (event, serverId, configContent) => await this.saveServerConfig(serverId, configContent));

        // Backup management
        ipcMain.handle('create-backup', async (event, serverId, backupType) => await this.createBackup(serverId, backupType));
        ipcMain.handle('create-full-backup-custom', async (event, serverId, customBackupPath) => await this.createFullBackupWithCustomPath(serverId, customBackupPath));
        ipcMain.handle('restore-backup', async (event, serverId, backupPath) => await this.restoreBackup(serverId, backupPath));
        ipcMain.handle('list-backups', async (event, serverId) => await this.listBackups(serverId));
        ipcMain.handle('cleanup-old-backups', async (event, serverId) => await this.cleanupOldBackups(serverId));

        // Settings
        ipcMain.handle('get-settings', () => this.settings);
        ipcMain.handle('save-settings', async (event, settings) => await this.saveSettings(settings));

        // RCon management
        ipcMain.handle('connect-rcon', async (event, serverId) => await this.connectRCon(serverId));
        ipcMain.handle('disconnect-rcon', async (event, serverId) => await this.disconnectRCon(serverId));
        ipcMain.handle('rcon-restart-server', async (event, serverId, warningMinutes, message) => await this.rconRestartServer(serverId, warningMinutes, message));
        ipcMain.handle('rcon-broadcast-message', async (event, serverId, message) => await this.rconBroadcastMessage(serverId, message));
        ipcMain.handle('rcon-get-players', async (event, serverId) => await this.rconGetPlayers(serverId));
        ipcMain.handle('rcon-kick-player', async (event, serverId, playerId, reason) => await this.rconKickPlayer(serverId, playerId, reason));
        ipcMain.handle('wipe-server-storage', async (event, serverId) => await this.wipeServerStorage(serverId));

        // BattlEye management
        ipcMain.handle('diagnose-battleye', async (event, serverId) => await this.diagnoseBattlEye(serverId));
        ipcMain.handle('setup-battleye', async (event, serverId) => await this.setupBattlEye(serverId));
        ipcMain.handle('fix-battleye-launch-params', async (event, serverId) => await this.fixBattlEyeLaunchParams(serverId));
        ipcMain.handle('get-battleye-troubleshooting', () => this.battleEyeManager.getTroubleshootingSteps());

        // File operations
        ipcMain.handle('select-folder', async () => {
            const result = await dialog.showOpenDialog(this.mainWindow, {
                properties: ['openDirectory']
            });
            return result.canceled ? { success: false } : { success: true, path: result.filePaths[0] };
        });

        ipcMain.handle('select-file', async (event, filters = []) => {
            const result = await dialog.showOpenDialog(this.mainWindow, {
                properties: ['openFile'],
                filters
            });
            return result.canceled ? null : result.filePaths[0];
        });

        ipcMain.handle('open-folder', async (event, folderPath) => {
            try {
                await shell.openPath(folderPath);
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('delete-folder', async (event, folderPath) => {
            try {
                await fs.remove(folderPath);
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });

        // Mod file operations
        ipcMain.handle('check-mod-installation', async (event, modId) => await this.checkModInstallation(modId));
        ipcMain.handle('install-single-mod', async (event, modId) => await this.installSingleMod(modId));
        ipcMain.handle('open-mod-location', async (event, modId) => {
            try {
                console.log(`Opening mod location for ${modId}`);
                
                // Use the same logic as checkModInstallation to find the correct path
                const installCheck = await this.checkModInstallation(modId);
                
                if (installCheck.installed && installCheck.path) {
                    const { shell } = require('electron');
                    console.log(`Opening path: ${installCheck.path}`);
                    await shell.openPath(installCheck.path);
                    return { success: true };
                } else {
                    console.log('Mod folder not found at any checked location');
                    return { success: false, error: 'Mod folder not found' };
                }
            } catch (error) {
                console.error('Error opening mod location:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('get-mod-source-path', async (event, modId) => {
            try {
                const modPath = path.join(this.settings.steamCmdPath, 'steamapps', 'workshop', 'content', '221100', modId);
                return { path: modPath, exists: await fs.pathExists(modPath) };
            } catch (error) {
                console.error('Error getting mod source path:', error);
                return { path: '', exists: false, error: error.message };
            }
        });

        ipcMain.handle('copy-mod', async (event, options) => {
            try {
                const { modId, sourcePath, destinationPath, overwriteExisting, createSubfolder } = options;
                
                if (!await fs.pathExists(sourcePath)) {
                    return { success: false, error: 'Source mod folder not found' };
                }

                let finalDestinationPath = destinationPath;
                if (createSubfolder) {
                    finalDestinationPath = path.join(destinationPath, `@${modId}`);
                }

                // Check if destination exists and handle overwrite
                if (await fs.pathExists(finalDestinationPath)) {
                    if (!overwriteExisting) {
                        return { success: false, error: 'Destination folder already exists' };
                    }
                    // Remove existing folder
                    await fs.remove(finalDestinationPath);
                }

                // Copy the mod folder
                await fs.copy(sourcePath, finalDestinationPath);

                return { 
                    success: true, 
                    finalPath: finalDestinationPath,
                    message: `Mod copied successfully to ${finalDestinationPath}` 
                };
            } catch (error) {
                console.error('Error copying mod:', error);
                return { success: false, error: error.message };
            }
        });

        // Get all unique mods from all servers
        ipcMain.handle('get-all-mods', async () => {
            try {
                const allMods = new Set();
                
                // Collect all mods from all servers
                for (const server of this.servers) {
                    if (server.mods && Array.isArray(server.mods)) {
                        for (const mod of server.mods) {
                            const modPath = path.join(this.settings.steamCmdPath, 'steamapps', 'workshop', 'content', '221100', mod.id);
                            allMods.add({
                                id: mod.id,
                                folderName: mod.folderName,
                                sourcePath: modPath
                            });
                        }
                    }
                }
                
                return Array.from(allMods);
            } catch (error) {
                console.error('Error getting all mods:', error);
                return [];
            }
        });

        // Keys management operations
        ipcMain.handle('update-server-keys-path', async (event, serverId, keysPath) => {
            try {
                const server = this.servers.find(s => s.id === serverId);
                if (!server) {
                    return { success: false, error: 'Server not found' };
                }

                server.keysPath = keysPath;
                await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
                
                return { success: true };
            } catch (error) {
                console.error('Error updating server keys path:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('pull-mod-keys', async (event, serverId) => {
            try {
                const server = this.servers.find(s => s.id === serverId);
                if (!server) {
                    return { success: false, error: 'Server not found' };
                }

                if (!server.keysPath) {
                    return { success: false, error: 'Keys folder not set for this server' };
                }

                // Defensive: handle case where keysPath might be an object instead of string
                let keysPath = server.keysPath;
                if (typeof keysPath === 'object' && keysPath.path) {
                    keysPath = keysPath.path;
                    // Fix the server config
                    server.keysPath = keysPath;
                    await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
                }

                if (!server.mods || server.mods.length === 0) {
                    return { success: false, error: 'No mods configured for this server' };
                }

                // Ensure keys directory exists
                await fs.ensureDir(keysPath);

                const copiedKeys = [];
                const errors = [];

                for (const mod of server.mods) {
                    try {
                        // Find the mod installation using the same logic as checkModInstallation
                        const installCheck = await this.checkModInstallation(mod.id);
                        
                        if (!installCheck.installed || !installCheck.path) {
                            errors.push(`Mod ${mod.id} not found - skipping`);
                            continue;
                        }

                        const modKeysPath = path.join(installCheck.path, 'Keys');
                        
                        if (await fs.pathExists(modKeysPath)) {
                            const keyFiles = await fs.readdir(modKeysPath);
                            const bikeyFiles = keyFiles.filter(file => file.toLowerCase().endsWith('.bikey'));
                            
                            for (const keyFile of bikeyFiles) {
                                const sourcePath = path.join(modKeysPath, keyFile);
                                const destPath = path.join(keysPath, keyFile);
                                
                                try {
                                    await fs.copy(sourcePath, destPath, { overwrite: true });
                                    copiedKeys.push(keyFile);
                                    console.log(`Copied key: ${keyFile} from mod ${mod.id}`);
                                } catch (copyError) {
                                    errors.push(`Failed to copy ${keyFile}: ${copyError.message}`);
                                }
                            }
                        } else {
                            // This is not an error - many mods don't have keys
                            console.log(`No Keys folder found for mod ${mod.id}`);
                        }
                    } catch (modError) {
                        errors.push(`Error processing mod ${mod.id}: ${modError.message}`);
                    }
                }

                return {
                    success: true,
                    copiedKeys: copiedKeys,
                    errors: errors.length > 0 ? errors : null
                };
            } catch (error) {
                console.error('Error pulling mod keys:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('edit-server-config', async (event, serverId) => {
            try {
                const server = this.servers.find(s => s.id === serverId);
                if (!server) {
                    return { success: false, error: 'Server not found' };
                }

                if (!server.serverPath) {
                    return { success: false, error: 'Server path not configured' };
                }

                // Construct the path to the serverDZ.cfg file
                const configFileName = server.configFile || 'serverDZ.cfg';
                const configPath = path.join(server.serverPath, configFileName);

                // Check if config file exists
                if (!(await fs.pathExists(configPath))) {
                    // Create a basic config file if it doesn't exist
                    const basicConfig = `// DayZ Server Configuration File
// Generated by DayZ Server Manager

hostname = "${server.name || 'DayZ Server'}";
password = "";
passwordAdmin = "";
maxPlayers = 60;

verifySignatures = 2;
forceSameBuild = 1;
disableVoN = 0;
vonCodecQuality = 7;
disable3rdPerson = 0;
disableCrosshair = 0;
serverTime = "";
serverTimeAcceleration = 0;
serverNightTimeAcceleration = 1;
serverTimePersistent = 0;
guaranteedUpdates = 1;
loginQueueConcurrentPlayers = 5;
loginQueueMaxPlayers = 500;
instanceId = ${server.instanceId || 1};
storageAutoFix = 1;

class Missions
{
    class DayZ
    {
        template="dayzOffline.chernarusplus";
    };
};
`;
                    try {
                        await fs.writeFile(configPath, basicConfig);
                        console.log(`Created basic config file: ${configPath}`);
                    } catch (createError) {
                        return { success: false, error: `Failed to create config file: ${createError.message}` };
                    }
                }

                // Open the config file with the default system editor
                try {
                    await shell.openPath(configPath);
                    console.log(`Opened config file: ${configPath}`);
                    return { success: true, configPath: configPath };
                } catch (openError) {
                    return { success: false, error: `Failed to open config file: ${openError.message}` };
                }
            } catch (error) {
                console.error('Error editing server config:', error);
                return { success: false, error: error.message };
            }
        });

        // Update a single setting
        ipcMain.handle('update-setting', async (event, key, value) => {
            try {
                this.settings[key] = value;
                await this.saveSettings(this.settings);
                return { success: true };
            } catch (error) {
                console.error('Error updating setting:', error);
                return { success: false, error: error.message };
            }
        });

        // Auto-updater IPC handlers
        ipcMain.handle('check-for-updates', async () => {
            try {
                console.log('🔍 MANUAL UPDATE CHECK TRIGGERED');
                console.log('NODE_ENV:', process.env.NODE_ENV);
                console.log('Current version:', app.getVersion());
                console.log('App is packaged:', app.isPackaged);
                console.log('Feed URL:', autoUpdater.getFeedURL());
                
                if (process.env.NODE_ENV === 'development') {
                    console.log('❌ Development mode - updates disabled');
                    return { success: false, error: 'Updates not available in development mode' };
                }
                
                console.log('🚀 Starting update check...');
                const result = await autoUpdater.checkForUpdatesAndNotify();
                console.log('📦 Update check result:', result);
                return { success: true, result };
            } catch (error) {
                console.error('💥 Error checking for updates:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('download-update', async () => {
            try {
                if (process.env.NODE_ENV === 'development') {
                    return { success: false, error: 'Updates not available in development mode' };
                }
                return autoUpdater.downloadUpdate();
            } catch (error) {
                console.error('Error downloading update:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('install-update', async () => {
            try {
                autoUpdater.quitAndInstall();
                return { success: true };
            } catch (error) {
                console.error('Error installing update:', error);
                return { success: false, error: error.message };
            }
        });
    }

    async saveServer(server) {
        try {
            const existingIndex = this.servers.findIndex(s => s.id === server.id);
            let isNewServer = false;
            
            if (existingIndex >= 0) {
                // Clear existing restart timers if they exist
                this.clearRestartTimers(server.id);
                // Disconnect existing RCon if password changed
                this.rconManager.disconnectRCon(server.id);
                this.servers[existingIndex] = server;
            } else {
                server.id = Date.now().toString();
                this.servers.push(server);
                isNewServer = true;
            }
            
            await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
            
            // Setup restart timers if scheduler is enabled
            if (server.restartScheduler && server.restartScheduler.enabled) {
                console.log(`⏰ Setting up restart schedule for server ${server.name}`);
                this.setupRestartTimers(server.id, server.restartScheduler);
            }
            
            // Initialize RCon if password is provided
            if (server.rconPassword) {
                try {
                    await this.rconManager.initializeRCon(server);
                    this.rconManager.setupRestartSchedule(server);
                    console.log(`RCon initialized for server: ${server.name}`);
                } catch (error) {
                    console.error(`Failed to initialize RCon for server ${server.name}:`, error);
                }
            }
            
            return server;
        } catch (error) {
            console.error('Error saving server:', error);
            throw error;
        }
    }

    async deleteServer(serverId) {
        try {
            this.servers = this.servers.filter(s => s.id !== serverId);
            await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
            
            // Stop server if running
            if (this.serverProcesses.has(serverId)) {
                await this.stopServer(serverId);
            }
        } catch (error) {
            console.error('Error deleting server:', error);
            throw error;
        }
    }

    async startServer(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) throw new Error('Server not found');

            if (this.serverProcesses.has(serverId)) {
                throw new Error('Server is already running');
            }

            // Set status to starting
            this.mainWindow?.webContents.send('server-status-changed', { serverId, status: 'starting' });

            // Validate required server properties
            if (!server.serverPath || !server.instanceId || !server.port) {
                throw new Error('Server configuration is incomplete. Please check server path, instance ID, and port.');
            }

            if (!server.profileName || server.profileName.trim() === '') {
                throw new Error('Profile name is required for the server configuration.');
            }

            // Check if DayZ server executable exists
            const serverExePath = path.join(server.serverPath, 'DayZServer_x64.exe');
            if (!await fs.pathExists(serverExePath)) {
                throw new Error(`DayZ Server executable not found at: ${serverExePath}`);
            }

            // Helper function to properly quote paths that contain spaces
            const quotePath = (filePath) => {
                if (filePath.includes(' ')) {
                    return `"${filePath}"`;
                }
                return filePath;
            };

            // Build command arguments using launch parameters
            const launchParams = server.launchParams || {};
            const profilesPath = launchParams.profilesPath || 'ServerProfiles';
            
            const args = [
                `-config=${server.configFile || 'serverDZ.cfg'}`,
                `-port=${server.port}`,
                `-cpuCount=${server.cpuCount || 4}`,
                `-profiles=${quotePath(profilesPath)}`
            ];

            // Add mission path if specified
            if (launchParams.missionPath) {
                args.push(`-mission=${quotePath(launchParams.missionPath)}`);
            }

            // Add verification signatures
            const verifySignatures = launchParams.verifySignatures !== undefined ? launchParams.verifySignatures : 2;
            if (verifySignatures !== 2) {
                args.push(`-verifySignatures=${verifySignatures}`);
            }

            // Add BattlEye path - properly handle paths with spaces
            let bePath = launchParams.bePath || 'battleye';
            
            // If the BattlEye path is relative, resolve it against the server path
            if (!path.isAbsolute(bePath)) {
                bePath = path.join(server.serverPath, bePath);
            }
            
            // Normalize the path for Windows and ensure proper format
            bePath = path.normalize(bePath);
            
            // Always quote the BattlEye path if it contains spaces or special characters
            const needsQuoting = bePath.includes(' ') || bePath.includes('&') || bePath.includes('"');
            if (needsQuoting) {
                args.push(`-BEpath="${bePath}"`);
            } else {
                args.push(`-BEpath=${bePath}`);
            }

            // Add FPS limit if specified
            if (launchParams.limitFPS && launchParams.limitFPS > 0) {
                args.push(`-limitFPS=${launchParams.limitFPS}`);
            }

            // Add boolean flags based on launch parameters
            if (launchParams.doLogs !== false) args.push('-dologs'); // Default true
            if (launchParams.adminLog !== false) args.push('-adminlog'); // Default true
            if (launchParams.netLog === true) args.push('-netlog');
            if (launchParams.freezeCheck !== false) args.push('-freezecheck'); // Default true
            if (launchParams.showScriptErrors === true) args.push('-showScriptErrors');
            if (launchParams.filePatching === true) args.push('-filePatching');

            // Add custom parameters if specified
            if (launchParams.customParameters && launchParams.customParameters.trim()) {
                const customParams = launchParams.customParameters
                    .split(/[\n\s]+/)
                    .filter(p => p.trim())
                    .filter(p => !p.startsWith('-mod=')); // Avoid duplicate mod parameters
                args.push(...customParams);
            }

            // Add mods if configured
            if (server.mods && server.mods.length > 0) {
                const validMods = server.mods.filter(mod => mod && mod.id && mod.id.trim() !== '');
                if (validMods.length > 0) {
                    console.log(`Starting server ${server.name} with ${validMods.length} mods: ${validMods.map(m => m.id).join(', ')}`);
                    
                    // Build mod paths - try workshop path first, then server directory
                    const modPaths = [];
                    for (const mod of validMods) {
                        // Try workshop path first (recommended)
                        const workshopPath = path.join(this.settings.workshopPath || path.join(this.settings.steamCmdPath, 'steamapps', 'workshop', 'content', '221100'), mod.id);
                        
                        try {
                            if (await fs.pathExists(workshopPath)) {
                                modPaths.push(workshopPath);
                                console.log(`Using workshop path for mod ${mod.id}: ${workshopPath}`);
                            } else if (mod.folderName) {
                                // Fallback to server directory with folder name
                                const serverModPath = path.join(server.serverPath, mod.folderName);
                                if (await fs.pathExists(serverModPath)) {
                                    modPaths.push(mod.folderName); // Use relative path for server directory mods
                                    console.log(`Using server directory for mod ${mod.id}: ${mod.folderName}`);
                                } else {
                                    console.warn(`Mod ${mod.id} not found at workshop path (${workshopPath}) or server directory (${serverModPath})`);
                                }
                            } else {
                                console.warn(`Mod ${mod.id} has no folderName and not found in workshop`);
                            }
                        } catch (error) {
                            console.error(`Error checking mod path for ${mod.id}:`, error);
                            // Fallback to folder name if available
                            if (mod.folderName) {
                                modPaths.push(mod.folderName);
                            }
                        }
                    }
                    
                    if (modPaths.length > 0) {
                        // Quote individual mod paths that contain spaces, then join with semicolons
                        const quotedModPaths = modPaths.map(modPath => {
                            // If it's an absolute path with spaces, quote it
                            if (path.isAbsolute(modPath) && modPath.includes(' ')) {
                                return `"${modPath}"`;
                            }
                            return modPath;
                        });
                        const modFolders = quotedModPaths.join(';');
                        args.push(`-mod=${modFolders}`);
                        console.log(`Final mod parameter: -mod=${modFolders}`);
                    } else {
                        console.warn('No valid mod paths found, starting server without mods');
                    }
                }
            }

            // Add server mods if configured
            if (server.serverMods && server.serverMods.length > 0) {
                const validServerMods = server.serverMods.filter(mod => mod && mod.id && mod.id.trim() !== '');
                if (validServerMods.length > 0) {
                    console.log(`Starting server ${server.name} with ${validServerMods.length} server mods: ${validServerMods.map(m => m.id).join(', ')}`);
                    
                    // Build server mod paths - try workshop path first, then server directory
                    const serverModPaths = [];
                    for (const mod of validServerMods) {
                        // Try workshop path first (recommended)
                        const workshopPath = path.join(this.settings.workshopPath || path.join(this.settings.steamCmdPath, 'steamapps', 'workshop', 'content', '221100'), mod.id);
                        
                        try {
                            if (await fs.pathExists(workshopPath)) {
                                serverModPaths.push(workshopPath);
                                console.log(`Using workshop path for server mod ${mod.id}: ${workshopPath}`);
                            } else if (mod.folderName) {
                                // Fallback to server directory with folder name
                                const serverModPath = path.join(server.serverPath, mod.folderName);
                                if (await fs.pathExists(serverModPath)) {
                                    serverModPaths.push(mod.folderName); // Use relative path for server directory mods
                                    console.log(`Using server directory for server mod ${mod.id}: ${mod.folderName}`);
                                } else {
                                    console.warn(`Server mod ${mod.id} not found at workshop path (${workshopPath}) or server directory (${serverModPath})`);
                                }
                            } else {
                                console.warn(`Server mod ${mod.id} has no folderName and not found in workshop`);
                            }
                        } catch (error) {
                            console.error(`Error checking server mod path for ${mod.id}:`, error);
                            // Fallback to folder name if available
                            if (mod.folderName) {
                                serverModPaths.push(mod.folderName);
                            }
                        }
                    }
                    
                    if (serverModPaths.length > 0) {
                        // Quote individual server mod paths that contain spaces, then join with semicolons
                        const quotedServerModPaths = serverModPaths.map(modPath => {
                            // If it's an absolute path with spaces, quote it
                            if (path.isAbsolute(modPath) && modPath.includes(' ')) {
                                return `"${modPath}"`;
                            }
                            return modPath;
                        });
                        const serverModFolders = quotedServerModPaths.join(';');
                        args.push(`-serverMod=${serverModFolders}`);
                        console.log(`Final server mod parameter: -serverMod=${serverModFolders}`);
                    } else {
                        console.warn('No valid server mod paths found, starting server without server mods');
                    }
                }
            }

            console.log(`Starting DayZ Server:`);
            console.log(`  Executable: "${serverExePath}"`);
            console.log(`  Working Directory: "${server.serverPath}"`);
            console.log(`  Arguments: [${args.map(arg => `"${arg}"`).join(', ')}]`);
            console.log(`  Full Command: "${serverExePath}" ${args.join(' ')}`);

            const serverProcess = spawn(serverExePath, args, {
                cwd: server.serverPath,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            const processInfo = {
                process: serverProcess,
                startTime: new Date(),
                server: server,
                pid: serverProcess.pid,
                restartTimer: null
            };

            this.serverProcesses.set(serverId, processInfo);

            // Set up auto-restart timer if configured
            if (launchParams.restartTimer && launchParams.restartTimer > 0) {
                const restartMs = launchParams.restartTimer * 60 * 60 * 1000; // Convert hours to milliseconds
                console.log(`Setting up auto-restart for server ${server.name} in ${launchParams.restartTimer} hours`);
                
                processInfo.restartTimer = setTimeout(async () => {
                    console.log(`Auto-restarting server ${server.name} after ${launchParams.restartTimer} hours`);
                    this.mainWindow?.webContents.send('server-log', { 
                        serverId, 
                        data: `[AUTO-RESTART] Scheduled restart after ${launchParams.restartTimer} hours\n` 
                    });
                    
                    try {
                        await this.stopServer(serverId);
                        // Wait a moment before restarting
                        setTimeout(() => {
                            this.startServer(serverId);
                        }, 5000);
                    } catch (error) {
                        console.error(`Failed to auto-restart server ${serverId}:`, error);
                        this.mainWindow?.webContents.send('server-log', { 
                            serverId, 
                            data: `[AUTO-RESTART] Failed to restart: ${error.message}\n` 
                        });
                    }
                }, restartMs);
            }

            // Start monitoring CPU/RAM for this server
            this.startServerMonitoring(serverId, serverProcess.pid);

            // Handle server output
            if (serverProcess.stdout) {
                serverProcess.stdout.on('data', (data) => {
                    console.log(`Server ${serverId} stdout: ${data}`);
                    this.mainWindow?.webContents.send('server-log', { serverId, data: data.toString() });
                });
            }

            if (serverProcess.stderr) {
                serverProcess.stderr.on('data', (data) => {
                    console.log(`Server ${serverId} stderr: ${data}`);
                    this.mainWindow?.webContents.send('server-log', { serverId, data: data.toString() });
                });
            }

            serverProcess.on('spawn', () => {
                console.log(`Server ${serverId} spawned successfully with PID ${serverProcess.pid}`);
                // Wait a moment then set to running
                setTimeout(() => {
                    this.mainWindow?.webContents.send('server-status-changed', { serverId, status: 'running' });
                }, 2000); // 2 second delay to show starting status
            });

            serverProcess.on('exit', (code) => {
                console.log(`Server ${serverId} exited with code ${code}`);
                
                // Clear restart timer if it exists
                const processInfo = this.serverProcesses.get(serverId);
                if (processInfo && processInfo.restartTimer) {
                    clearTimeout(processInfo.restartTimer);
                    console.log(`Cleared restart timer for server ${serverId}`);
                }
                
                this.stopServerMonitoring(serverId);
                this.serverProcesses.delete(serverId);
                this.mainWindow?.webContents.send('server-status-changed', { serverId, status: 'stopped' });
            });

            serverProcess.on('error', (error) => {
                console.error(`Server ${serverId} spawn error:`, error);
                console.error(`Failed command: "${serverExePath}" ${args.join(' ')}`);
                console.error(`Working directory: "${server.serverPath}"`);
                
                this.stopServerMonitoring(serverId);
                this.serverProcesses.delete(serverId);
                this.mainWindow?.webContents.send('server-status-changed', { serverId, status: 'stopped' });
                this.mainWindow?.webContents.send('server-log', { 
                    serverId, 
                    data: `[ERROR] Failed to start server: ${error.message}\n[ERROR] Command: "${serverExePath}" ${args.join(' ')}\n` 
                });
                throw new Error(`Failed to spawn server process: ${error.message}`);
            });

            return true;

        } catch (error) {
            console.error('Error starting server:', error);
            // Reset status to stopped on error
            this.mainWindow?.webContents.send('server-status-changed', { serverId, status: 'stopped' });
            throw error;
        }
    }

    async stopServer(serverId) {
        try {
            const serverInfo = this.serverProcesses.get(serverId);
            if (!serverInfo) {
                throw new Error('Server is not running');
            }

            // Clear restart timer if it exists
            if (serverInfo.restartTimer) {
                clearTimeout(serverInfo.restartTimer);
                console.log(`Cleared restart timer for server ${serverId}`);
            }

            // Stop monitoring first
            this.stopServerMonitoring(serverId);

            serverInfo.process.kill('SIGTERM');
            this.serverProcesses.delete(serverId);
            this.mainWindow?.webContents.send('server-status-changed', { serverId, status: 'stopped' });
            return true;

        } catch (error) {
            console.error('Error stopping server:', error);
            throw error;
        }
    }

    getServerStatus(serverId) {
        const status = this.serverProcesses.has(serverId) ? 'running' : 'stopped';
        
        // Also return resource information if available
        const serverInfo = this.serverProcesses.get(serverId);
        if (serverInfo) {
            return {
                status: status,
                pid: serverInfo.pid,
                startTime: serverInfo.startTime
            };
        }
        
        return status;
    }

    startServerMonitoring(serverId, pid) {
        // Clear any existing monitoring for this server
        this.stopServerMonitoring(serverId);

        console.log(`Starting monitoring for server ${serverId} with PID ${pid}`);

        const monitoringInterval = setInterval(async () => {
            try {
                const stats = await pidusage(pid);
                
                // Send resource usage to renderer
                this.mainWindow?.webContents.send('server-resources', {
                    serverId,
                    resources: {
                        cpu: Math.round(stats.cpu * 100) / 100, // CPU percentage
                        memory: Math.round(stats.memory / 1024 / 1024), // Memory in MB
                        uptime: Math.floor((Date.now() - stats.timestamp) / 1000) // Uptime in seconds
                    }
                });
            } catch (error) {
                // Process might have ended, stop monitoring
                console.log(`Monitoring stopped for server ${serverId}: ${error.message}`);
                this.stopServerMonitoring(serverId);
            }
        }, 2000); // Update every 2 seconds

        this.monitoringIntervals.set(serverId, monitoringInterval);
    }

    stopServerMonitoring(serverId) {
        const interval = this.monitoringIntervals.get(serverId);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(serverId);
            console.log(`Stopped monitoring for server ${serverId}`);
        }
    }

    async checkModUpdatesAvailable(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server || !server.mods || !this.settings.steamWebApiKey) {
                return { hasUpdates: false, mods: [] };
            }

            const modIds = server.mods.map(mod => mod.id);
            const modDetails = await this.getModDetailsFromAPI(modIds);
            const updatesAvailable = [];

            for (const mod of server.mods) {
                const apiMod = modDetails.find(m => m.publishedfileid === mod.id);
                if (apiMod) {
                    const lastKnownUpdate = this.modVersions[mod.id]?.lastUpdated || 0;
                    const currentUpdate = parseInt(apiMod.time_updated);
                    
                    if (currentUpdate > lastKnownUpdate) {
                        updatesAvailable.push({
                            id: mod.id,
                            folderName: mod.folderName,
                            title: apiMod.title,
                            lastKnownUpdate: new Date(lastKnownUpdate * 1000),
                            currentUpdate: new Date(currentUpdate * 1000),
                            needsUpdate: true
                        });
                    }
                }
            }

            return {
                hasUpdates: updatesAvailable.length > 0,
                mods: updatesAvailable,
                totalMods: server.mods.length
            };
        } catch (error) {
            console.error('Error checking mod updates:', error);
            return { hasUpdates: false, mods: [], error: error.message };
        }
    }

    async getModDetailsFromAPI(modIds) {
        if (!this.settings.steamWebApiKey || !modIds.length) {
            return [];
        }

        try {
            const url = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
            const formData = new URLSearchParams();
            formData.append('key', this.settings.steamWebApiKey);
            formData.append('itemcount', modIds.length.toString());
            
            modIds.forEach((id, index) => {
                formData.append(`publishedfileids[${index}]`, id);
            });

            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (!response.ok) {
                throw new Error(`Steam API request failed: ${response.status}`);
            }

            const data = await response.json();
            return data.response?.publishedfiledetails || [];
        } catch (error) {
            console.error('Error fetching mod details from Steam API:', error);
            throw error;
        }
    }

    async saveModVersion(modId, lastUpdated) {
        try {
            this.modVersions[modId] = {
                lastUpdated: lastUpdated,
                lastChecked: Math.floor(Date.now() / 1000)
            };
            await fs.writeJson(this.modVersionsConfigPath, this.modVersions, { spaces: 2 });
        } catch (error) {
            console.error('Error saving mod version:', error);
        }
    }

    async updateMods(serverId) {
        // Implementation for SteamCMD mod updates
        const server = this.servers.find(s => s.id === serverId);
        if (!server || !server.mods) return;

        for (const mod of server.mods) {
            await this.downloadMod(mod.id, server.steamUsername, server.steamPassword);
        }
    }

    async updateSingleMod(modId) {
        try {
            // Find servers that use this mod to get Steam credentials
            const serversWithMod = this.servers.filter(server => 
                server.mods && server.mods.some(mod => mod.id === modId)
            );
            
            if (serversWithMod.length === 0) {
                throw new Error(`No servers found using mod ${modId}`);
            }
            
            // Use the first server's credentials (or we could make this configurable)
            const server = serversWithMod[0];
            
            // Check if we have Steam credentials
            let username = server.steamUsername;
            let password = server.steamPassword;
            
            // Fall back to global settings if no server-specific credentials
            if (!username || !password) {
                username = this.settings.steamUsername;
                password = this.settings.steamPassword;
            }
            
            if (!username || !password) {
                throw new Error('Steam credentials not configured. Please set Steam username and password in server settings or global settings.');
            }
            
            // Validate SteamCMD path
            if (!this.settings.steamCmdPath) {
                throw new Error('SteamCMD path not configured. Please set the SteamCMD path in settings.');
            }
            
            const steamCmdPath = path.join(this.settings.steamCmdPath, 'steamcmd.exe');
            
            // Check if SteamCMD exists
            if (!await fs.pathExists(steamCmdPath)) {
                throw new Error(`SteamCMD not found at ${steamCmdPath}. Please verify the SteamCMD path in settings.`);
            }
            
            console.log(`Updating mod ${modId} using SteamCMD...`);
            
            await this.downloadMod(modId, username, password);
            
            // After successful download, sync the mod to all servers that use it
            for (const serverWithMod of serversWithMod) {
                await this.syncSingleModToServer(modId, serverWithMod);
            }
            
            console.log(`Mod ${modId} updated successfully`);
            return { success: true, message: `Mod ${modId} updated successfully` };
            
        } catch (error) {
            console.error(`Error updating mod ${modId}:`, error);
            throw error;
        }
    }

    async syncSingleModToServer(modId, server) {
        try {
            // Get the mod folder name from server config
            const mod = server.mods.find(m => m.id === modId);
            if (!mod || !mod.folderName) {
                console.warn(`Mod ${modId} not found in server ${server.name} configuration`);
                return;
            }
            
            const workshopPath = this.settings.workshopPath || path.join(this.settings.steamCmdPath, '..', 'steamapps', 'workshop', 'content', '221100');
            const sourcePath = path.join(workshopPath, modId);
            const targetPath = path.join(server.path, mod.folderName);
            
            // Check if source mod exists
            if (!await fs.pathExists(sourcePath)) {
                throw new Error(`Downloaded mod not found at ${sourcePath}`);
            }
            
            // Remove existing mod folder if it exists
            if (await fs.pathExists(targetPath)) {
                await fs.remove(targetPath);
            }
            
            // Copy the mod from workshop to server
            await fs.copy(sourcePath, targetPath);
            
            console.log(`Synced mod ${modId} to server ${server.name}`);
            
        } catch (error) {
            console.error(`Error syncing mod ${modId} to server ${server.name}:`, error);
            throw error;
        }
    }

    async downloadMod(modId, username, password) {
        return new Promise((resolve, reject) => {
            const steamCmdPath = path.join(this.settings.steamCmdPath, 'steamcmd.exe');
            
            // SteamCMD arguments for downloading workshop item
            const args = [
                '+login', username, password,
                '+workshop_download_item', '221100', modId,
                '+quit'
            ];

            console.log(`Executing SteamCMD: ${steamCmdPath} ${args.join(' ')}`);
            
            const steamProcess = spawn(steamCmdPath, args, {
                cwd: this.settings.steamCmdPath,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let output = '';
            let errorOutput = '';
            
            steamProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log(`SteamCMD stdout: ${text.trim()}`);
                
                // Send progress updates to the renderer if needed
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('steamcmd-output', {
                        type: 'stdout',
                        data: text,
                        modId: modId
                    });
                }
            });
            
            steamProcess.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                console.error(`SteamCMD stderr: ${text.trim()}`);
                
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('steamcmd-output', {
                        type: 'stderr',
                        data: text,
                        modId: modId
                    });
                }
            });
            
            steamProcess.on('close', async (code) => {
                console.log(`SteamCMD process exited with code ${code}`);
                
                if (code === 0) {
                    // Check if the download was actually successful
                    if (output.includes('Success.') || output.includes('Update state (')) {
                        // Save the current timestamp as the last updated version
                        await this.saveModVersion(modId, Math.floor(Date.now() / 1000));
                        resolve();
                    } else if (output.includes('No subscription')) {
                        reject(new Error(`No subscription found for mod ${modId}. Make sure the mod is public or you have access to it.`));
                    } else if (output.includes('Invalid login')) {
                        reject(new Error('Invalid Steam credentials. Please check your username and password.'));
                    } else {
                        reject(new Error(`SteamCMD completed but mod download may have failed. Check the logs for details.`));
                    }
                } else {
                    let errorMessage = `SteamCMD exited with code ${code}`;
                    
                    if (code === 5) {
                        errorMessage = 'Steam rate limit exceeded. Please try again later (wait 10-15 minutes). Consider disabling automatic mod updates to avoid this issue.';
                    } else if (errorOutput.includes('Invalid Password') || output.includes('Invalid Password')) {
                        errorMessage = 'Invalid Steam password. Please check your credentials.';
                    } else if (errorOutput.includes('Invalid login') || output.includes('Invalid login')) {
                        errorMessage = 'Invalid Steam login. Please check your username and password.';
                    } else if (errorOutput.includes('Two-factor') || output.includes('Two-factor')) {
                        errorMessage = 'Steam Guard two-factor authentication required. Please disable Steam Guard or use an app password.';
                    } else if (output.includes('No subscription')) {
                        errorMessage = `No subscription found for mod ${modId}. The mod may be private or no longer available.`;
                    } else if (output.includes('Rate Limit Exceeded') || errorOutput.includes('Rate Limit Exceeded')) {
                        errorMessage = 'Steam rate limit exceeded. Please try again later (wait 10-15 minutes). Consider using manual mod copying instead.';
                    }
                    
                    reject(new Error(errorMessage));
                }
            });
            
            steamProcess.on('error', (error) => {
                console.error(`Failed to start SteamCMD process:`, error);
                reject(new Error(`Failed to start SteamCMD: ${error.message}. Please check that SteamCMD is installed and the path is correct.`));
            });
        });
    }

    async searchWorkshopMods(searchQuery, page = 1) {
        try {
            console.log(`🔍 Searching Workshop for: "${searchQuery}" (page ${page})`);
            
            if (!this.settings.steamWebApiKey) {
                throw new Error('Steam Web API key not configured. Please set your Steam Web API key in settings.');
            }

            // Steam Workshop search parameters
            const itemsPerPage = 20;
            const url = 'https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/';
            const params = new URLSearchParams({
                key: this.settings.steamWebApiKey,
                appid: '221100', // DayZ App ID
                search_text: searchQuery,
                page: page.toString(),
                numperpage: itemsPerPage.toString(),
                return_metadata: 'true',
                return_short_description: 'true',
                return_tags: 'true',
                return_previews: 'true'
            });

            console.log(`🌐 API Request: ${url}?${params}`);
            
            const response = await fetch(`${url}?${params}`);
            if (!response.ok) {
                throw new Error(`Steam API request failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const files = data.response?.publishedfiledetails || [];
            
            console.log(`📦 Found ${files.length} mods for search: "${searchQuery}"`);
            
            return {
                success: true,
                mods: files.map(mod => ({
                    id: mod.publishedfileid,
                    title: mod.title,
                    description: mod.short_description || mod.file_description || 'No description available',
                    author: mod.creator,
                    subscriptions: mod.subscriptions || 0,
                    favorites: mod.favorited || 0,
                    created: mod.time_created,
                    updated: mod.time_updated,
                    fileSize: mod.file_size,
                    previewUrl: mod.preview_url,
                    tags: mod.tags?.map(tag => tag.tag) || [],
                    visibility: mod.visibility // 0 = public, 1 = friends only, 2 = private
                })).filter(mod => mod.visibility === 0), // Only show public mods
                totalResults: data.response?.total || 0,
                currentPage: page,
                hasMore: files.length === itemsPerPage
            };
        } catch (error) {
            console.error('❌ Error searching workshop mods:', error);
            return { success: false, error: error.message, mods: [] };
        }
    }

    async getModChangelog(modId) {
        try {
            console.log(`📋 Getting changelog for mod ${modId}`);
            
            if (!this.settings.steamWebApiKey) {
                throw new Error('Steam Web API key not configured');
            }

            // First get the mod details to get change history
            const detailsUrl = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
            const formData = new URLSearchParams();
            formData.append('key', this.settings.steamWebApiKey);
            formData.append('itemcount', '1');
            formData.append('publishedfileids[0]', modId);

            const detailsResponse = await fetch(detailsUrl, {
                method: 'POST',
                body: formData,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            if (!detailsResponse.ok) {
                throw new Error(`Steam API request failed: ${detailsResponse.status}`);
            }

            const detailsData = await detailsResponse.json();
            const modDetails = detailsData.response?.publishedfiledetails?.[0];

            if (!modDetails || modDetails.result !== 1) {
                throw new Error('Mod not found or inaccessible');
            }

            // Get change history if available
            const historyUrl = 'https://api.steampowered.com/IPublishedFileService/GetDetails/v1/';
            const historyParams = new URLSearchParams({
                key: this.settings.steamWebApiKey,
                publishedfileids: modId,
                includetags: 'true',
                includeadditionalpreviews: 'false',
                includechildren: 'false',
                includekvtags: 'false',
                includevotes: 'true',
                short_description: 'true',
                includeforsaledata: 'false',
                includemetadata: 'true'
            });

            const historyResponse = await fetch(`${historyUrl}?${historyParams}`);
            let changeHistory = [];
            
            if (historyResponse.ok) {
                const historyData = await historyResponse.json();
                const publishedFile = historyData.response?.publishedfiledetails?.[0];
                
                if (publishedFile?.change_description) {
                    changeHistory.push({
                        timestamp: publishedFile.time_updated,
                        description: publishedFile.change_description,
                        isLatest: true
                    });
                }
            }

            return {
                success: true,
                modId: modId,
                title: modDetails.title,
                lastUpdated: modDetails.time_updated,
                changeHistory: changeHistory,
                description: modDetails.file_description || 'No description available',
                hasChangelog: changeHistory.length > 0
            };
        } catch (error) {
            console.error(`❌ Error getting changelog for mod ${modId}:`, error);
            return { success: false, error: error.message };
        }
    }

    async addModToServer(serverId, modData) {
        try {
            console.log(`➕ Adding mod ${modData.id} to server ${serverId}`);
            
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                throw new Error('Server not found');
            }

            // Initialize mods array if it doesn't exist
            if (!server.mods) {
                server.mods = [];
            }

            // Check if mod already exists
            const existingMod = server.mods.find(m => m.id === modData.id);
            if (existingMod) {
                throw new Error('Mod is already added to this server');
            }

            // Add the mod to the server
            const newMod = {
                id: modData.id,
                folderName: `@${modData.title.replace(/[^a-zA-Z0-9]/g, '_')}_${modData.id}`,
                title: modData.title,
                description: modData.description,
                addedAt: new Date().toISOString(),
                author: modData.author
            };

            server.mods.push(newMod);

            // Save the updated server configuration
            await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
            
            console.log(`✅ Successfully added mod ${modData.title} to server ${server.name}`);
            
            return {
                success: true,
                message: `Mod "${modData.title}" added to server "${server.name}"`,
                mod: newMod
            };
        } catch (error) {
            console.error(`❌ Error adding mod to server:`, error);
            return { success: false, error: error.message };
        }
    }

    async setServerRestartSchedule(serverId, schedule) {
        try {
            console.log(`⏰ Setting restart schedule for server ${serverId}:`, schedule);
            
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                throw new Error('Server not found');
            }

            // Clear existing schedule for this server
            await this.clearServerRestartSchedule(serverId);

            // Validate schedule format
            if (!Array.isArray(schedule.times) || schedule.times.length === 0) {
                throw new Error('Schedule must include at least one restart time');
            }

            // Validate time format (HH:MM)
            const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
            for (const time of schedule.times) {
                if (!timeRegex.test(time)) {
                    throw new Error(`Invalid time format: ${time}. Use HH:MM format (24-hour)`);
                }
            }

            // Store schedule in server config
            server.restartScheduler = {
                enabled: schedule.enabled !== false, // Default to true
                times: schedule.times,
                warningTime: schedule.warningTime || 15,
                restartMessage: schedule.restartMessage || 'Server restart in {time} minutes. Please find a safe location.',
                createdAt: new Date().toISOString()
            };

            // Save server configuration
            await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });

            // Set up the actual scheduled restarts
            if (server.restartScheduler.enabled) {
                this.setupRestartTimers(serverId, server.restartScheduler);
            }

            console.log(`✅ Restart schedule set for server ${server.name}`);
            
            return {
                success: true,
                message: `Restart schedule set for server "${server.name}"`,
                schedule: server.restartScheduler
            };
        } catch (error) {
            console.error(`❌ Error setting restart schedule:`, error);
            return { success: false, error: error.message };
        }
    }

    getServerRestartSchedule(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            return {
                success: true,
                schedule: server.restartScheduler || null,
                isActive: this.restartSchedules.has(serverId)
            };
        } catch (error) {
            console.error(`❌ Error getting restart schedule:`, error);
            return { success: false, error: error.message };
        }
    }

    async clearServerRestartSchedule(serverId) {
        try {
            console.log(`🗑️ Clearing restart schedule for server ${serverId}`);
            
            // Clear any existing timers
            if (this.restartSchedules.has(serverId)) {
                const scheduleData = this.restartSchedules.get(serverId);
                scheduleData.timers.forEach(timer => clearTimeout(timer));
                this.restartSchedules.delete(serverId);
                console.log(`🛑 Cleared ${scheduleData.timers.length} restart timers for server ${serverId}`);
            }

            // Remove from server config
            const server = this.servers.find(s => s.id === serverId);
            if (server && server.restartScheduler) {
                delete server.restartScheduler;
                await fs.writeJson(this.serversConfigPath, this.servers, { spaces: 2 });
            }

            return { success: true };
        } catch (error) {
            console.error(`❌ Error clearing restart schedule:`, error);
            return { success: false, error: error.message };
        }
    }

    setupRestartTimers(serverId, schedule) {
        try {
            console.log(`⏰ Setting up restart timers for server ${serverId}`);
            
            const timers = [];
            const server = this.servers.find(s => s.id === serverId);
            
            for (const timeStr of schedule.times) {
                const [hours, minutes] = timeStr.split(':').map(Number);
                
                // Calculate milliseconds until next occurrence of this time
                const now = new Date();
                const targetTime = new Date();
                targetTime.setHours(hours, minutes, 0, 0);
                
                // If the time has already passed today, schedule for tomorrow
                if (targetTime <= now) {
                    targetTime.setDate(targetTime.getDate() + 1);
                }
                
                const msUntilRestart = targetTime.getTime() - now.getTime();
                
                console.log(`⏰ Server ${server?.name || serverId} scheduled restart at ${timeStr} (${Math.round(msUntilRestart / 1000 / 60)} minutes from now)`);
                
                const timer = setTimeout(async () => {
                    console.log(`🔄 Executing scheduled restart for server ${server?.name || serverId} at ${timeStr}`);
                    
                    try {
                        // Send notification to renderer
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('server-log', {
                                serverId,
                                data: `[SCHEDULED RESTART] Restarting server at scheduled time: ${timeStr}\n`
                            });
                        }
                        
                        // Stop the server
                        if (this.serverProcesses.has(serverId)) {
                            await this.stopServer(serverId);
                            
                            // Wait 5 seconds then restart
                            setTimeout(async () => {
                                try {
                                    await this.startServer(serverId);
                                    if (this.mainWindow) {
                                        this.mainWindow.webContents.send('server-log', {
                                            serverId,
                                            data: `[SCHEDULED RESTART] Server restarted successfully\n`
                                        });
                                    }
                                } catch (restartError) {
                                    console.error(`❌ Failed to restart server ${serverId}:`, restartError);
                                    if (this.mainWindow) {
                                        this.mainWindow.webContents.send('server-log', {
                                            serverId,
                                            data: `[SCHEDULED RESTART] Failed to restart: ${restartError.message}\n`
                                        });
                                    }
                                }
                            }, 5000);
                        } else {
                            console.log(`⚠️ Server ${serverId} was not running for scheduled restart`);
                        }
                        
                        // Schedule next occurrence (24 hours later)
                        const nextTimer = setTimeout(async () => {
                            // Re-setup this specific timer for tomorrow
                            this.setupSingleRestartTimer(serverId, timeStr);
                        }, 24 * 60 * 60 * 1000); // 24 hours
                        
                        // Update the timer in our tracking
                        if (this.restartSchedules.has(serverId)) {
                            const scheduleData = this.restartSchedules.get(serverId);
                            const timerIndex = scheduleData.timers.indexOf(timer);
                            if (timerIndex !== -1) {
                                scheduleData.timers[timerIndex] = nextTimer;
                            }
                        }
                        
                    } catch (error) {
                        console.error(`❌ Error during scheduled restart for server ${serverId}:`, error);
                        if (this.mainWindow) {
                            this.mainWindow.webContents.send('server-log', {
                                serverId,
                                data: `[SCHEDULED RESTART] Error: ${error.message}\n`
                            });
                        }
                    }
                }, msUntilRestart);
                
                timers.push(timer);
            }
            
            // Store timers for this server
            this.restartSchedules.set(serverId, {
                schedule: schedule,
                timers: timers,
                setupAt: new Date().toISOString()
            });
            
            console.log(`✅ Set up ${timers.length} restart timers for server ${server?.name || serverId}`);
            
        } catch (error) {
            console.error(`❌ Error setting up restart timers for server ${serverId}:`, error);
        }
    }

    clearRestartTimers(serverId) {
        try {
            if (this.restartSchedules.has(serverId)) {
                const scheduleData = this.restartSchedules.get(serverId);
                
                // Clear all timers for this server
                scheduleData.timers.forEach(timer => {
                    clearTimeout(timer);
                });
                
                // Remove from the schedules map
                this.restartSchedules.delete(serverId);
                
                console.log(`✅ Cleared restart timers for server ${serverId}`);
            }
        } catch (error) {
            console.error(`❌ Error clearing restart timers for server ${serverId}:`, error);
        }
    }

    setupSingleRestartTimer(serverId, timeStr) {
        // Helper method to set up a single restart timer
        const [hours, minutes] = timeStr.split(':').map(Number);
        const now = new Date();
        const targetTime = new Date();
        targetTime.setHours(hours, minutes, 0, 0);
        targetTime.setDate(targetTime.getDate() + 1); // Always schedule for tomorrow
        
        const msUntilRestart = targetTime.getTime() - now.getTime();
        
        const timer = setTimeout(async () => {
            // Same restart logic as above
            console.log(`🔄 Executing scheduled restart for server ${serverId} at ${timeStr}`);
            // ... restart logic would go here
            // Then schedule next occurrence
            this.setupSingleRestartTimer(serverId, timeStr);
        }, msUntilRestart);
        
        // Add timer to existing schedule
        if (this.restartSchedules.has(serverId)) {
            const scheduleData = this.restartSchedules.get(serverId);
            scheduleData.timers.push(timer);
        }
    }

    async saveSettings(settings) {
        try {
            this.settings = { ...this.settings, ...settings };
            await fs.writeJson(this.settingsConfigPath, this.settings, { spaces: 2 });
        } catch (error) {
            console.error('Error saving settings:', error);
            throw error;
        }
    }

    async checkForModUpdatesOnStartup() {
        try {
            console.log('Checking for mod updates on startup...');
            
            // Send status to renderer
            this.mainWindow?.webContents.send('startup-status', 'Checking for mod updates...');
            
            // Check if settings are loaded and auto-update is enabled
            if (!this.settings || !this.settings.autoModUpdate) {
                console.log('Auto mod update is disabled');
                this.mainWindow?.webContents.send('startup-status', 'Auto mod update disabled');
                return;
            }

            // Get all servers with mods
            const serversWithMods = this.servers.filter(server => 
                server.mods && server.mods.length > 0 && 
                server.steamUsername && server.steamPassword
            );

            if (serversWithMods.length === 0) {
                console.log('No servers with mods configured for updates');
                this.mainWindow?.webContents.send('startup-status', 'No servers configured for mod updates');
                return;
            }

            this.mainWindow?.webContents.send('startup-status', `Updating mods for ${serversWithMods.length} server(s)...`);

            // Update mods for each server
            for (const server of serversWithMods) {
                try {
                    console.log(`Updating mods for server: ${server.name}`);
                    this.mainWindow?.webContents.send('startup-status', `Updating mods for ${server.name}...`);
                    
                    await this.updateMods(server.id);
                    
                    console.log(`Mods updated successfully for server: ${server.name}`);
                } catch (error) {
                    console.error(`Failed to update mods for server ${server.name}:`, error);
                    
                    // Check for rate limiting and send appropriate message
                    if (error.message.includes('rate limit') || error.message.includes('Rate Limit') || error.message.includes('code 5')) {
                        console.warn('Steam rate limiting detected during startup');
                        this.mainWindow?.webContents.send('startup-status', `Steam rate limit exceeded - Use Copy All Mods feature instead`);
                        return; // Stop trying other servers to avoid more rate limiting
                    } else {
                        this.mainWindow?.webContents.send('startup-status', `Failed to update mods for ${server.name}: ${error.message}`);
                    }
                }
            }

            this.mainWindow?.webContents.send('startup-status', 'Mod updates completed');
            console.log('Startup mod update check completed');

        } catch (error) {
            console.error('Error during startup mod update check:', error);
            this.mainWindow?.webContents.send('startup-status', `Error checking for updates: ${error.message}`);
        }
    }

    /**
     * Get mod information from Steam Web API
     */
    async getModInfo(modId) {
        try {
            const url = `https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`;
            
            const formData = new URLSearchParams();
            formData.append('key', this.settings.steamWebApiKey);
            formData.append('itemcount', '1');
            formData.append('publishedfileids[0]', modId);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            });

            const data = await response.json();
            
            if (data.response && data.response.publishedfiledetails && data.response.publishedfiledetails[0]) {
                const modInfo = data.response.publishedfiledetails[0];
                return {
                    id: modId,
                    title: modInfo.title,
                    description: modInfo.description,
                    creator: modInfo.creator,
                    time_created: modInfo.time_created,
                    time_updated: modInfo.time_updated,
                    subscriptions: modInfo.subscriptions,
                    favorited: modInfo.favorited,
                    file_size: modInfo.file_size,
                    preview_url: modInfo.preview_url,
                    tags: modInfo.tags || []
                };
            }
            
            throw new Error('Mod not found or invalid response');
            
        } catch (error) {
            console.error(`Error fetching mod info for ${modId}:`, error);
            throw error;
        }
    }

    /**
     * Check if mods have updates available
     */
    async checkModUpdates(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server || !server.mods || server.mods.length === 0) {
                return [];
            }

            const updateInfo = [];
            
            for (const mod of server.mods) {
                if (!mod.id) continue;
                
                try {
                    const modInfo = await this.getModInfo(mod.id);
                    
                    // Check if local mod exists and compare timestamps
                    const localModPath = path.join(server.serverPath, mod.folderName);
                    let needsUpdate = true;
                    
                    if (await fs.pathExists(localModPath)) {
                        const localStat = await fs.stat(localModPath);
                        const localTime = Math.floor(localStat.mtime.getTime() / 1000);
                        needsUpdate = modInfo.time_updated > localTime;
                    }
                    
                    updateInfo.push({
                        ...modInfo,
                        folderName: mod.folderName,
                        needsUpdate: needsUpdate,
                        localPath: localModPath
                    });
                    
                } catch (error) {
                    console.warn(`Could not check update for mod ${mod.id}:`, error);
                    updateInfo.push({
                        id: mod.id,
                        folderName: mod.folderName,
                        needsUpdate: false,
                        error: error.message
                    });
                }
            }
            
            return updateInfo;
            
        } catch (error) {
            console.error('Error checking mod updates:', error);
            throw error;
        }
    }

    async createBackup(serverId, backupType = 'standard') {
        try {
            const servers = await this.loadServers();
            const server = servers.find(s => s.id === serverId);
            
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            // Check if backup path is set
            if (!server.backupPath) {
                return { success: false, error: 'Backup path not configured for this server' };
            }

            const settings = await this.loadSettings();
            const backupManager = new BackupManager(settings);
            
            let result;
            if (backupType === 'full') {
                console.log(`Creating full backup for server ${server.name}`);
                result = await backupManager.createFullBackup(server);
            } else {
                console.log(`Creating standard backup for server ${server.name}`);
                result = await backupManager.createBackup(server);
            }
            
            return { 
                success: true, 
                backupDir: result.backupDir,
                filesBackedUp: result.filesBackedUp,
                backupInfo: result.backupInfo
            };
        } catch (error) {
            console.error('Error creating backup:', error);
            return { success: false, error: error.message };
        }
    }

    async createFullBackupWithCustomPath(serverId, customBackupPath) {
        try {
            const servers = await this.loadServers();
            const server = servers.find(s => s.id === serverId);
            
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            const settings = await this.loadSettings();
            const backupManager = new BackupManager(settings);
            
            console.log(`Creating full backup for server ${server.name} to custom path ${customBackupPath}`);
            const result = await backupManager.createFullBackup(server, customBackupPath);
            
            return { 
                success: true, 
                backupDir: result.backupDir,
                filesBackedUp: result.filesBackedUp,
                backupInfo: result.backupInfo
            };
        } catch (error) {
            console.error('Error creating full backup:', error);
            return { success: false, error: error.message };
        }
    }

    async restoreBackup(serverId, backupPath) {
        try {
            const servers = await this.loadServers();
            const server = servers.find(s => s.id === serverId);
            
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            const settings = await this.loadSettings();
            const backupManager = new BackupManager(settings);
            
            console.log(`Restoring backup for server ${server.name} from ${backupPath}`);
            const result = await backupManager.restoreBackup(server, backupPath);
            
            return { 
                success: true, 
                filesRestored: result.filesRestored
            };
        } catch (error) {
            console.error('Error restoring backup:', error);
            return { success: false, error: error.message };
        }
    }

    async listBackups(serverId) {
        try {
            const servers = await this.loadServers();
            const server = servers.find(s => s.id === serverId);
            
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            if (!server.backupPath) {
                return { success: true, backups: [] };
            }

            const settings = await this.loadSettings();
            const backupManager = new BackupManager(settings);
            
            const backups = await backupManager.listBackups(server);
            
            return { 
                success: true, 
                backups: backups
            };
        } catch (error) {
            console.error('Error listing backups:', error);
            return { success: false, error: error.message };
        }
    }

    async cleanupOldBackups(serverId) {
        try {
            const servers = await this.loadServers();
            const server = servers.find(s => s.id === serverId);
            
            if (!server || !server.backupPath) {
                return { success: false, error: 'Server or backup path not found' };
            }

            const settings = await this.loadSettings();
            const backupManager = new BackupManager(settings);
            
            await backupManager.cleanupOldBackups(server.backupPath);
            
            return { success: true };
        } catch (error) {
            console.error('Error cleaning up backups:', error);
            return { success: false, error: error.message };
        }
    }

    async readServerConfig(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                throw new Error('Server not found');
            }

            const configPath = path.join(server.serverPath, server.configFile || 'serverDZ.cfg');
            
            if (await fs.pathExists(configPath)) {
                const configContent = await fs.readFile(configPath, 'utf8');
                return {
                    success: true,
                    content: configContent,
                    path: configPath
                };
            } else {
                return {
                    success: false,
                    error: 'Configuration file not found',
                    path: configPath
                };
            }
        } catch (error) {
            console.error('Error reading server config:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async saveServerConfig(serverId, configContent) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                throw new Error('Server not found');
            }

            const configPath = path.join(server.serverPath, server.configFile || 'serverDZ.cfg');
            
            // Create backup before saving
            const backupPath = configPath + '.backup.' + Date.now();
            if (await fs.pathExists(configPath)) {
                await fs.copy(configPath, backupPath);
            }

            await fs.writeFile(configPath, configContent, 'utf8');
            
            return {
                success: true,
                message: 'Configuration saved successfully',
                backupCreated: backupPath
            };
        } catch (error) {
            console.error('Error saving server config:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async checkModInstallation(modId) {
        try {
            console.log(`Checking mod installation for ${modId}`);
            
            // Check multiple possible locations for mods
            const possiblePaths = [];
            
            // Add workshopPath if configured
            if (this.settings.workshopPath) {
                possiblePaths.push(path.join(this.settings.workshopPath, modId));
                console.log(`Added workshopPath: ${this.settings.workshopPath}`);
            }
            
            // Add steamCmdPath workshop location if configured
            if (this.settings.steamCmdPath) {
                possiblePaths.push(path.join(this.settings.steamCmdPath, 'steamapps', 'workshop', 'content', '221100', modId));
                console.log(`Added steamCmdPath: ${this.settings.steamCmdPath}`);
            }
            
            // Add common Steam workshop locations
            const commonPaths = [
                path.join('C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\221100', modId),
                path.join('C:\\Steam\\steamapps\\workshop\\content\\221100', modId),
                path.join(process.env.USERPROFILE || '', 'AppData\\Local\\Steam\\steamapps\\workshop\\content\\221100', modId)
            ];
            
            possiblePaths.push(...commonPaths);
            
            console.log(`Checking ${possiblePaths.length} possible paths for mod ${modId}`);
            
            // Check each path until we find one that exists
            for (const modPath of possiblePaths) {
                console.log(`Checking path: ${modPath}`);
                const exists = await fs.pathExists(modPath);
                console.log(`Path exists: ${exists}`);
                
                if (exists) {
                    console.log(`Found mod at: ${modPath}`);
                    return {
                        success: true,
                        installed: true,
                        modId: modId,
                        path: modPath
                    };
                }
            }
            
            // If we get here, the mod wasn't found in any location
            console.log(`Mod ${modId} not found in any checked location`);
            return {
                success: true,
                installed: false,
                modId: modId,
                path: null
            };
        } catch (error) {
            console.error('Error checking mod installation:', error);
            return {
                success: false,
                installed: false,
                error: error.message
            };
        }
    }

    async installSingleMod(modId) {
        try {
            if (!this.settings.steamCmdPath) {
                throw new Error('SteamCMD path not configured');
            }

            const steamCmdExe = path.join(this.settings.steamCmdPath, 'steamcmd.exe');
            if (!await fs.pathExists(steamCmdExe)) {
                throw new Error('SteamCMD executable not found');
            }

            const steamUsername = this.settings.steamUsername || 'anonymous';
            const steamPassword = this.settings.steamPassword || '';

            let command;
            if (steamUsername === 'anonymous') {
                command = `"${steamCmdExe}" +login anonymous +workshop_download_item 221100 ${modId} +quit`;
            } else {
                command = `"${steamCmdExe}" +login "${steamUsername}" "${steamPassword}" +workshop_download_item 221100 ${modId} +quit`;
            }

            return new Promise((resolve, reject) => {
                exec(command, { 
                    cwd: this.settings.steamCmdPath,
                    timeout: 300000 // 5 minute timeout
                }, (error, stdout, stderr) => {
                    if (error) {
                        console.error('SteamCMD error:', error);
                        resolve({
                            success: false,
                            error: error.message,
                            output: stderr || stdout
                        });
                    } else {
                        resolve({
                            success: true,
                            message: `Mod ${modId} downloaded successfully`,
                            output: stdout
                        });
                    }
                });
            });
        } catch (error) {
            console.error('Error installing mod:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // RCon Management Methods
    async initializeRConConnections() {
        console.log('🔗 Initializing RCon connections...');
        
        for (const server of this.servers) {
            if (server.rconPassword) {
                try {
                    await this.rconManager.initializeRCon(server);
                    this.rconManager.setupRestartSchedule(server);
                    console.log(`RCon initialized for server: ${server.name}`);
                } catch (error) {
                    console.error(`Failed to initialize RCon for server ${server.name}:`, error);
                }
            } else {
                console.log(`Server ${server.name} has no RCon password configured`);
            }
        }
    }

    async connectRCon(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            if (!server.rconPassword) {
                return { success: false, error: 'RCon password not configured for this server' };
            }

            const success = await this.rconManager.initializeRCon(server);
            if (success) {
                this.rconManager.setupRestartSchedule(server);
                return { success: true, message: 'RCon connected successfully' };
            } else {
                return { success: false, error: 'Failed to connect to RCon' };
            }
        } catch (error) {
            console.error('Error connecting RCon:', error);
            return { success: false, error: error.message };
        }
    }

    async disconnectRCon(serverId) {
        try {
            this.rconManager.disconnectRCon(serverId);
            return { success: true, message: 'RCon disconnected successfully' };
        } catch (error) {
            console.error('Error disconnecting RCon:', error);
            return { success: false, error: error.message };
        }
    }

    async rconRestartServer(serverId, warningMinutes = 5, message = 'Server restart in {time} minutes') {
        try {
            return await this.rconManager.restartServerWithWarning(serverId, warningMinutes, message);
        } catch (error) {
            console.error('Error executing RCon restart:', error);
            return { success: false, error: error.message };
        }
    }

    async rconBroadcastMessage(serverId, message) {
        try {
            return await this.rconManager.broadcastMessage(serverId, message);
        } catch (error) {
            console.error('Error broadcasting message via RCon:', error);
            return { success: false, error: error.message };
        }
    }

    async rconGetPlayers(serverId) {
        try {
            return await this.rconManager.getPlayers(serverId);
        } catch (error) {
            console.error('Error getting players via RCon:', error);
            return { success: false, error: error.message };
        }
    }

    async rconKickPlayer(serverId, playerId, reason = 'Kicked by admin') {
        try {
            return await this.rconManager.kickPlayer(serverId, playerId, reason);
        } catch (error) {
            console.error('Error kicking player via RCon:', error);
            return { success: false, error: error.message };
        }
    }

    async wipeServerStorage(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            return await this.rconManager.wipeServerStorage(server);
        } catch (error) {
            console.error('Error wiping server storage:', error);
            return { success: false, error: error.message };
        }
    }

    // BattlEye Management Methods
    async diagnoseBattlEye(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            if (!server.serverPath) {
                return { success: false, error: 'Server path not configured' };
            }

            // Determine BattlEye path from server configuration or use default
            const battleEyePath = server.battleEyePath || path.join(server.serverPath, 'battleye');
            
            const results = await this.battleEyeManager.diagnoseBattlEye(server.serverPath, battleEyePath);
            
            return { success: true, results };
        } catch (error) {
            console.error('Error diagnosing BattlEye:', error);
            return { success: false, error: error.message };
        }
    }

    async setupBattlEye(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            if (!server.serverPath) {
                return { success: false, error: 'Server path not configured' };
            }

            // Determine BattlEye path from server configuration or use default
            const battleEyePath = server.battleEyePath || path.join(server.serverPath, 'battleye');
            
            const results = await this.battleEyeManager.setupBattlEye(battleEyePath);
            
            // Update server configuration with BattlEye path if successful
            if (results.success && !server.battleEyePath) {
                server.battleEyePath = battleEyePath;
                await this.saveServer(server);
            }
            
            return results;
        } catch (error) {
            console.error('Error setting up BattlEye:', error);
            return { success: false, error: error.message };
        }
    }

    async fixBattlEyeLaunchParams(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                return { success: false, error: 'Server not found' };
            }

            if (!server.serverPath) {
                return { success: false, error: 'Server path not configured' };
            }

            // Get current launch parameters
            const currentParams = server.launchParameters || '';
            
            // Fix the launch parameters
            const results = this.battleEyeManager.fixLaunchParameters(currentParams, server.serverPath);
            
            // Update server configuration if changes were made
            if (results.changes.length > 0) {
                server.launchParameters = results.fixed;
                await this.saveServer(server);
                results.updated = true;
            } else {
                results.updated = false;
            }
            
            return { success: true, results };
        } catch (error) {
            console.error('Error fixing BattlEye launch parameters:', error);
            return { success: false, error: error.message };
        }
    }
}

// Initialize the application
let serverManager;

app.whenReady().then(async () => {
    if (serverManager) {
        return; // Prevent multiple initializations
    }
    
    serverManager = new DayZServerManager();
    
    // Create splash screen first
    serverManager.createSplashWindow();
    
    // Wait a moment for splash to render, then start initialization
    setTimeout(() => {
        serverManager.initializeApp();
    }, 500);
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        if (serverManager && !serverManager.isTransitioning && !serverManager.mainWindow) {
            serverManager.createWindow();
        }
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    // Cleanup: stop all running servers
    // This will be implemented based on the manager instance
});
