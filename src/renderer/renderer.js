const { ipcRenderer } = require('electron');

class DayZServerManagerUI {
    constructor() {
        this.servers = [];
        this.settings = {};
        this.currentEditingServer = null;
        this.serverStatuses = new Map(); // Track server statuses
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupIpcListeners();
        await this.loadData();
        this.renderServers();
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab(item.getAttribute('data-tab'));
            });
        });

        // Progress modal setup
        this.setupProgressModal();

        // Header buttons
        document.getElementById('addServerBtn').addEventListener('click', () => this.showServerModal());
        document.getElementById('settingsBtn').addEventListener('click', () => this.showSettingsModal());

        // Server actions
        document.getElementById('startAllBtn').addEventListener('click', () => this.startAllServers());
        document.getElementById('stopAllBtn').addEventListener('click', () => this.stopAllServers());
        document.getElementById('updateAllBtn').addEventListener('click', () => this.updateAllModsWithProgress());

        // Modal events
        this.setupModalEvents();
        
        // Form events
        this.setupFormEvents();
        
        // Launch parameters preview update
        this.setupLaunchParametersPreview();
    }

    setupModalEvents() {
        // Server modal
        const serverModal = document.getElementById('serverModal');
        const settingsModal = document.getElementById('settingsModal');

        // Close modals
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', () => {
                this.hideModals();
            });
        });

        document.getElementById('cancelServerBtn').addEventListener('click', () => this.hideModals());
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => this.hideModals());

        // Save buttons
        document.getElementById('saveServerBtn').addEventListener('click', () => this.saveServer());
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettings());

        // Click outside to close
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideModals();
            }
        });
    }

    setupFormEvents() {
        // Browse buttons
        document.getElementById('browseServerPath').addEventListener('click', async () => {
            const result = await ipcRenderer.invoke('select-folder');
            if (result && result.success) document.getElementById('serverPath').value = result.path;
        });

        document.getElementById('browseBackupPath').addEventListener('click', async () => {
            const result = await ipcRenderer.invoke('select-folder');
            if (result && result.success) document.getElementById('backupPath').value = result.path;
        });

        document.getElementById('browseKeysPath').addEventListener('click', async () => {
            const result = await ipcRenderer.invoke('select-folder');
            if (result && result.success) document.getElementById('keysPath').value = result.path;
        });

        document.getElementById('browseSteamCmdPath').addEventListener('click', async () => {
            const result = await ipcRenderer.invoke('select-folder');
            if (result && result.success) document.getElementById('steamCmdPath').value = result.path;
        });

        document.getElementById('browseWorkshopPath').addEventListener('click', async () => {
            const result = await ipcRenderer.invoke('select-folder');
            if (result && result.success) document.getElementById('workshopPath').value = result.path;
        });

        document.getElementById('browseDefaultModCopyPath').addEventListener('click', async () => {
            const result = await ipcRenderer.invoke('select-folder');
            if (result && result.success) {
                document.getElementById('defaultModCopyPath').value = result.path;
            }
        });
    }

    setupLaunchParametersPreview() {
        // List of all form elements that affect launch parameters
        const parameterElements = [
            'serverPath', 'configFile', 'port', 'cpuCount', 'profilesPath', 'missionPath',
            'doLogs', 'adminLog', 'netLog', 'freezeCheck', 'showScriptErrors', 'filePatching',
            'verifySignatures', 'bePath', 'limitFPS', 'customParameters', 'modList'
        ];

        // Add event listeners to all parameter elements
        parameterElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                const eventType = element.type === 'checkbox' ? 'change' : 'input';
                element.addEventListener(eventType, () => this.updateLaunchParametersPreview());
            }
        });
    }

    updateLaunchParametersPreview() {
        const serverPath = document.getElementById('serverPath').value || 'C:\\Path\\To\\DayZServer';
        const configFile = document.getElementById('configFile').value || 'serverDZ.cfg';
        const port = document.getElementById('port').value || '2302';
        const cpuCount = document.getElementById('cpuCount').value || '4';
        const profilesPath = document.getElementById('profilesPath').value || 'ServerProfiles';
        const missionPath = document.getElementById('missionPath').value;
        
        // Build the basic command
        let command = `"${serverPath}\\DayZServer_x64.exe"`;
        
        // Add configuration parameters
        command += ` -config=${configFile}`;
        command += ` -port=${port}`;
        command += ` -cpuCount=${cpuCount}`;
        command += ` -profiles=${profilesPath}`;
        
        if (missionPath) {
            command += ` -mission=${missionPath}`;
        }
        
        // Add verification signatures
        const verifySignatures = document.getElementById('verifySignatures').value;
        if (verifySignatures && verifySignatures !== '2') {
            command += ` -verifySignatures=${verifySignatures}`;
        }
        
        // Add BattlEye path if specified
        const bePath = document.getElementById('bePath').value;
        if (bePath) {
            command += ` -BEpath=${bePath}`;
        }
        
        // Add FPS limit if specified
        const limitFPS = document.getElementById('limitFPS').value;
        if (limitFPS) {
            command += ` -limitFPS=${limitFPS}`;
        }
        
        // Add boolean flags
        if (document.getElementById('doLogs').checked) command += ' -dologs';
        if (document.getElementById('adminLog').checked) command += ' -adminlog';
        if (document.getElementById('netLog').checked) command += ' -netlog';
        if (document.getElementById('freezeCheck').checked) command += ' -freezecheck';
        if (document.getElementById('showScriptErrors').checked) command += ' -showScriptErrors';
        if (document.getElementById('filePatching').checked) command += ' -filePatching';
        
        // Add mods if any
        const modListText = document.getElementById('modList').value;
        if (modListText.trim()) {
            const mods = modListText.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const [id, folderName] = line.split(',').map(s => s.trim());
                    return folderName || `@Mod_${id}`;
                })
                .filter(mod => mod);
            
            if (mods.length > 0) {
                command += ` "-mod=${mods.join(';')}"`;
            }
        }
        
        // Add custom parameters
        const customParams = document.getElementById('customParameters').value;
        if (customParams.trim()) {
            // Split by newlines or spaces and filter out empty strings
            const params = customParams.split(/[\n\s]+/).filter(p => p.trim());
            command += ' ' + params.join(' ');
        }
        
        // Update the preview textarea
        const previewElement = document.getElementById('launchParametersPreview');
        if (previewElement) {
            previewElement.value = command;
        }
    }

    setupIpcListeners() {
        ipcRenderer.on('server-status-changed', (event, data) => {
            this.updateServerStatus(data.serverId, data.status);
        });

        ipcRenderer.on('server-resources', (event, data) => {
            this.updateServerResources(data.serverId, data.resources);
        });

        ipcRenderer.on('startup-status', (event, message) => {
            this.updateStartupStatus(message);
        });
        
        ipcRenderer.on('steamcmd-output', (event, data) => {
            this.handleSteamCmdOutput(data);
        });

        ipcRenderer.on('new-server', () => this.showServerModal());
        ipcRenderer.on('open-settings', () => this.showSettingsModal());

        // Manual update check from menu
        ipcRenderer.on('check-for-updates-manual', () => {
            this.checkForUpdates();
        });

        // Auto-updater listeners
        ipcRenderer.on('update-available', (event, updateInfo) => {
            this.showUpdateAvailableModal(updateInfo);
        });

        ipcRenderer.on('update-progress', (event, progressObj) => {
            this.updateDownloadProgress(progressObj);
        });

        ipcRenderer.on('update-downloaded', (event, updateInfo) => {
            this.showUpdateReadyModal(updateInfo);
        });
    }

    async loadData() {
        try {
            this.servers = await ipcRenderer.invoke('get-servers');
            this.settings = await ipcRenderer.invoke('get-settings');
            
            // Load current server statuses
            for (const server of this.servers) {
                try {
                    const status = await ipcRenderer.invoke('get-server-status', server.id);
                    this.serverStatuses.set(server.id, typeof status === 'object' ? status.status : status);
                } catch (error) {
                    console.warn(`Failed to get status for server ${server.id}:`, error);
                    this.serverStatuses.set(server.id, 'stopped');
                }
            }
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load data');
        }
    }

    switchTab(tabName) {
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');

        // Load tab-specific data
        this.loadTabData(tabName);
    }

    loadTabData(tabName) {
        switch (tabName) {
            case 'servers':
                this.renderServers();
                break;
            case 'mods':
                this.renderMods();
                this.setupModTabButtons();
                break;
            case 'backups':
                this.renderBackups();
                break;
            case 'logs':
                this.renderLogs();
                break;
            case 'console':
                this.renderConsole();
                break;
        }
    }

    setupModTabButtons() {
        // Set up mod tab specific buttons
        const updateModsBtn = document.getElementById('updateModsBtn');
        const addModBtn = document.getElementById('addModBtn');
        
        if (updateModsBtn) {
            // Remove existing listeners
            updateModsBtn.replaceWith(updateModsBtn.cloneNode(true));
            const newUpdateModsBtn = document.getElementById('updateModsBtn');
            newUpdateModsBtn.addEventListener('click', () => this.updateAllModsWithProgress());
        }
        
        const copyAllModsBtn = document.getElementById('copyAllModsBtn');
        if (copyAllModsBtn) {
            // Remove existing listeners  
            copyAllModsBtn.replaceWith(copyAllModsBtn.cloneNode(true));
            const newCopyAllModsBtn = document.getElementById('copyAllModsBtn');
            newCopyAllModsBtn.addEventListener('click', () => this.showCopyAllModsModal());
        }
        
        if (addModBtn) {
            // Remove existing listeners  
            addModBtn.replaceWith(addModBtn.cloneNode(true));
            const newAddModBtn = document.getElementById('addModBtn');
            newAddModBtn.addEventListener('click', () => this.showAddModModal());
        }
    }

    renderServers() {
        const container = document.getElementById('servers-container');
        
        if (this.servers.length === 0) {
            container.innerHTML = `
                <div class="text-center" style="grid-column: 1 / -1; padding: 2rem;">
                    <i class="fas fa-server fa-3x text-muted mb-2"></i>
                    <h3 class="text-muted">No servers configured</h3>
                    <p class="text-muted">Click "Add Server" to get started</p>
                    <button class="btn btn-primary" onclick="app.showServerModal()">
                        <i class="fas fa-plus"></i> Add Your First Server
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = this.servers.map(server => this.createServerCard(server)).join('');
    }

    createServerCard(server) {
        const status = this.getServerStatus(server.id);
        const statusClass = `status-${status}`;
        
        return `
            <div class="server-card fade-in" data-server-id="${server.id}">
                <div class="server-header">
                    <h3 class="server-name">${server.name}</h3>
                    <span class="server-status ${statusClass}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>
                </div>
                <div class="server-info">
                    <div class="server-info-item">
                        <span class="label">Instance ID:</span>
                        <span>${server.instanceId}</span>
                    </div>
                    <div class="server-info-item">
                        <span class="label">Port:</span>
                        <span>${server.port}</span>
                    </div>
                    <div class="server-info-item">
                        <span class="label">Profile:</span>
                        <span>${server.profileName}</span>
                    </div>
                    <div class="server-info-item">
                        <span class="label">Mods:</span>
                        <span>${server.mods ? server.mods.length : 0}</span>
                    </div>
                    <!-- Resources will be dynamically added here for running servers -->
                </div>
                <div class="server-actions">
                    ${status === 'running' 
                        ? `<button class="btn btn-danger stop-btn" onclick="app.stopServer('${server.id}')">
                               <i class="fas fa-stop"></i> Stop
                           </button>`
                        : status === 'starting'
                        ? `<button class="btn btn-warning" disabled>
                               <i class="fas fa-spinner fa-spin"></i> Starting...
                           </button>`
                        : `<button class="btn btn-success start-btn" onclick="app.startServer('${server.id}')">
                               <i class="fas fa-play"></i> Start
                           </button>`
                    }
                    <button class="btn btn-primary" onclick="app.checkModUpdates('${server.id}')" title="Check for mod updates using Steam Web API">
                        <i class="fas fa-search"></i> Check Updates
                    </button>
                    <button class="btn btn-info" onclick="app.updateServerMods('${server.id}')" title="Force update all mods via SteamCMD">
                        <i class="fas fa-sync"></i> Update Mods
                    </button>
                    <button class="btn btn-secondary" onclick="app.editServerConfig('${server.id}')" title="Edit serverDZ.cfg file">
                        <i class="fas fa-cog"></i> Config
                    </button>
                    <button class="btn btn-warning" onclick="app.backupServer('${server.id}')">
                        <i class="fas fa-save"></i> Backup
                    </button>
                    <button class="btn btn-info" onclick="app.setServerKeysFolder('${server.id}')" title="Set the keys folder path for this server">
                        <i class="fas fa-key"></i> Set Keys Folder
                    </button>
                    <button class="btn btn-success" onclick="app.pullModKeys('${server.id}')" title="Copy all mod keys from installed mods to server keys folder">
                        <i class="fas fa-download"></i> Pull Mod Keys
                    </button>
                    <button class="btn btn-secondary" onclick="app.editServer('${server.id}')">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-danger" onclick="app.deleteServer('${server.id}')">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `;
    }

    async renderMods() {
        const container = document.getElementById('mods-container');
        
        // Collect all unique mods from all servers
        const allMods = new Map();
        
        this.servers.forEach(server => {
            if (server.mods && server.mods.length > 0) {
                server.mods.forEach(mod => {
                    if (mod.id && mod.folderName) {
                        if (!allMods.has(mod.id)) {
                            allMods.set(mod.id, {
                                ...mod,
                                servers: [server.name]
                            });
                        } else {
                            const existingMod = allMods.get(mod.id);
                            if (!existingMod.servers.includes(server.name)) {
                                existingMod.servers.push(server.name);
                            }
                        }
                    }
                });
            }
        });

        if (allMods.size === 0) {
            container.innerHTML = `
                <div class="text-center" style="padding: 2rem;">
                    <i class="fas fa-puzzle-piece fa-3x text-muted mb-2"></i>
                    <h3 class="text-muted">No mods configured</h3>
                    <p class="text-muted">Add mods to your server configurations to see them here</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="mods-grid">
                ${Array.from(allMods.values()).map(mod => this.createModCard(mod)).join('')}
            </div>
        `;

        // Check installation status for all mods
        await this.checkModInstallationStatus(Array.from(allMods.keys()));
        
        // Load mod details from Steam Web API
        this.loadModDetails(Array.from(allMods.keys()));
    }

    async checkModInstallationStatus(modIds) {
        for (const modId of modIds) {
            try {
                const installStatus = await ipcRenderer.invoke('check-mod-installation', modId);
                this.updateModInstallationStatus(modId, installStatus);
            } catch (error) {
                console.error(`Failed to check installation status for mod ${modId}:`, error);
                this.updateModInstallationStatus(modId, { installed: false, error: error.message });
            }
        }
    }

    updateModInstallationStatus(modId, status) {
        const statusElement = document.getElementById(`mod-install-status-${modId}`);
        const actionButton = document.getElementById(`mod-action-${modId}`);
        
        if (statusElement) {
            let statusHtml = '';
            let statusClass = '';
            
            if (status.installed) {
                statusClass = 'installed';
                statusHtml = `
                    <i class="fas fa-check-circle"></i>
                    <span>Installed</span>
                    ${status.lastModified ? `<small>Modified: ${new Date(status.lastModified).toLocaleDateString()}</small>` : ''}
                `;
                
                if (actionButton) {
                    actionButton.innerHTML = '<i class="fas fa-sync"></i> Update';
                    actionButton.className = 'btn btn-info btn-sm';
                    actionButton.setAttribute('onclick', `app.updateSingleMod('${modId}')`);
                }
            } else {
                statusClass = 'not-installed';
                statusHtml = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Not Installed</span>
                `;
                
                if (actionButton) {
                    actionButton.innerHTML = '<i class="fas fa-download"></i> Install';
                    actionButton.className = 'btn btn-success btn-sm';
                    actionButton.setAttribute('onclick', `app.installSingleMod('${modId}')`);
                }
            }
            
            statusElement.innerHTML = statusHtml;
            statusElement.className = `mod-install-status ${statusClass}`;
        }
    }

    createModCard(mod) {
        return `
            <div class="mod-card" id="mod-${mod.id}">
                <div class="mod-header">
                    <div class="mod-info">
                        <h4 class="mod-title" id="mod-title-${mod.id}">
                            <i class="fas fa-spinner fa-spin"></i> Loading...
                        </h4>
                        <p class="mod-id">ID: ${mod.id}</p>
                        <p class="mod-folder">Folder: ${mod.folderName}</p>
                    </div>
                    <div class="mod-status">
                        <div class="mod-install-status checking" id="mod-install-status-${mod.id}">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>Checking...</span>
                        </div>
                        <span class="mod-servers">Used by: ${mod.servers.join(', ')}</span>
                    </div>
                </div>
                
                <div class="mod-details" id="mod-details-${mod.id}">
                    <div class="mod-loading">
                        <i class="fas fa-spinner fa-spin"></i> Loading mod details...
                    </div>
                </div>
                
                <div class="mod-actions">
                    <button class="btn btn-info btn-sm" id="mod-action-${mod.id}" onclick="app.updateSingleMod('${mod.id}')">
                        <i class="fas fa-sync"></i> Update
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="app.openModWorkshop('${mod.id}')">
                        <i class="fas fa-external-link-alt"></i> Workshop
                    </button>
                    <button class="btn btn-warning btn-sm" onclick="app.checkModUpdates('${mod.id}')">
                        <i class="fas fa-search"></i> Check Status
                    </button>
                    <button class="btn btn-success btn-sm" onclick="app.viewModLocation('${mod.id}')">
                        <i class="fas fa-folder-open"></i> View Location
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="app.showModCopyModal('${mod.id}')">
                        <i class="fas fa-copy"></i> Copy Mod
                    </button>
                </div>
            </div>
        `;
    }

    async loadModDetails(modIds) {
        for (const modId of modIds) {
            try {
                const modInfo = await ipcRenderer.invoke('get-mod-info', modId);
                this.updateModCard(modId, modInfo);
            } catch (error) {
                console.error(`Failed to load details for mod ${modId}:`, error);
                this.updateModCardError(modId, error.message);
            }
        }
    }

    updateModCard(modId, modInfo) {
        const titleElement = document.getElementById(`mod-title-${modId}`);
        const detailsElement = document.getElementById(`mod-details-${modId}`);
        
        if (titleElement) {
            titleElement.innerHTML = `
                <i class="fas fa-puzzle-piece"></i> ${modInfo.title || 'Unknown Mod'}
            `;
        }
        
        if (detailsElement) {
            const lastUpdated = new Date(modInfo.time_updated * 1000).toLocaleDateString();
            const fileSize = this.formatFileSize(modInfo.file_size);
            
            detailsElement.innerHTML = `
                <div class="mod-meta">
                    <div class="mod-meta-item">
                        <span class="label">Creator:</span>
                        <span>${modInfo.creator || 'Unknown'}</span>
                    </div>
                    <div class="mod-meta-item">
                        <span class="label">Last Updated:</span>
                        <span>${lastUpdated}</span>
                    </div>
                    <div class="mod-meta-item">
                        <span class="label">File Size:</span>
                        <span>${fileSize}</span>
                    </div>
                    <div class="mod-meta-item">
                        <span class="label">Subscribers:</span>
                        <span>${modInfo.subscriptions ? modInfo.subscriptions.toLocaleString() : 'N/A'}</span>
                    </div>
                </div>
                
                ${modInfo.description ? `
                    <div class="mod-description">
                        <h5>Description:</h5>
                        <p>${this.truncateText(modInfo.description, 200)}</p>
                    </div>
                ` : ''}
                
                ${modInfo.tags && modInfo.tags.length > 0 ? `
                    <div class="mod-tags">
                        ${modInfo.tags.slice(0, 5).map(tag => `<span class="mod-tag">${tag.tag}</span>`).join('')}
                    </div>
                ` : ''}
            `;
        }
    }

    updateModCardError(modId, errorMessage) {
        const titleElement = document.getElementById(`mod-title-${modId}`);
        const detailsElement = document.getElementById(`mod-details-${modId}`);
        
        if (titleElement) {
            titleElement.innerHTML = `
                <i class="fas fa-exclamation-triangle text-warning"></i> Mod ${modId}
            `;
        }
        
        if (detailsElement) {
            detailsElement.innerHTML = `
                <div class="mod-error">
                    <i class="fas fa-exclamation-triangle text-warning"></i>
                    <span>Failed to load mod details: ${errorMessage}</span>
                </div>
            `;
        }
    }

    formatFileSize(bytes) {
        if (!bytes) return 'Unknown';
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    async updateSingleMod(modId) {
        try {
            this.showLoading(true);
            
            // Show progress feedback
            this.showSuccess(`Starting update for mod ${modId}...`);
            
            const result = await ipcRenderer.invoke('update-single-mod', modId);
            
            if (result.success) {
                this.showSuccess(result.message);
                
                // Refresh the mod manager to show updated status
                if (document.getElementById('mods-tab').classList.contains('active')) {
                    this.renderMods();
                }
                
                // Refresh server display if on servers tab
                if (document.getElementById('servers-tab').classList.contains('active')) {
                    this.renderServers();
                }
            }
        } catch (error) {
            console.error('Error updating mod:', error);
            this.showError(`Failed to update mod ${modId}: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async installSingleMod(modId) {
        try {
            this.showLoading(true);
            
            // Show progress feedback
            this.showSuccess(`Starting installation for mod ${modId}...`);
            
            const result = await ipcRenderer.invoke('install-single-mod', modId);
            
            if (result.success) {
                this.showSuccess(result.message);
                
                // Refresh the mod manager to show updated status
                if (document.getElementById('mods-tab').classList.contains('active')) {
                    this.renderMods();
                }
                
                // Refresh server display if on servers tab
                if (document.getElementById('servers-tab').classList.contains('active')) {
                    this.renderServers();
                }
            } else {
                this.showError(`Failed to install mod ${modId}: ${result.error}`);
            }
        } catch (error) {
            console.error('Error installing mod:', error);
            this.showError(`Failed to install mod ${modId}: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    openModWorkshop(modId) {
        const { shell } = require('electron');
        shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}`);
    }

    async checkModUpdates(modId) {
        try {
            this.showLoading(true);
            
            const serversWithMod = this.servers.filter(server => 
                server.mods && server.mods.some(mod => mod.id === modId)
            );
            
            for (const server of serversWithMod) {
                const updateInfo = await ipcRenderer.invoke('check-mod-updates', server.id);
                const modUpdateInfo = updateInfo.find(info => info.id === modId);
                
                if (modUpdateInfo) {
                    const message = modUpdateInfo.needsUpdate 
                        ? `Mod ${modId} has updates available`
                        : `Mod ${modId} is up to date`;
                    this.showSuccess(message);
                    break;
                }
            }
        } catch (error) {
            console.error('Error checking mod updates:', error);
            this.showError(`Failed to check mod updates: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async renderBackups() {
        const container = document.getElementById('backups-container');
        
        if (this.servers.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3 class="text-muted">No Servers Configured</h3>
                    <p class="text-muted">Add servers first to manage backups</p>
                </div>
            `;
            return;
        }

        let backupsHtml = `
            <div class="backup-management">
                <div class="backup-actions">
                    <button class="btn btn-primary" id="createBackupAllBtn">
                        <i class="fas fa-save"></i> Backup All Servers
                    </button>
                    <button class="btn btn-warning" id="cleanupBackupsBtn">
                        <i class="fas fa-broom"></i> Cleanup Old Backups
                    </button>
                </div>
                
                <div class="servers-backup-list">
        `;

        for (const server of this.servers) {
            const backupConfigured = server.backupPath ? 'configured' : 'not-configured';
            backupsHtml += `
                <div class="server-backup-card ${backupConfigured}">
                    <div class="server-backup-header">
                        <h4>${server.name}</h4>
                        <div class="backup-status">
                            ${server.backupPath ? 
                                `<span class="status-badge configured"><i class="fas fa-check-circle"></i> Configured</span>` :
                                `<span class="status-badge not-configured"><i class="fas fa-exclamation-triangle"></i> Not Configured</span>`
                            }
                        </div>
                    </div>
                    
                    <div class="server-backup-info">
                        <p><strong>Backup Path:</strong> ${server.backupPath || 'Not set'}</p>
                        <p><strong>Profile:</strong> ${server.profileName}</p>
                        <p><strong>Server Path:</strong> ${server.serverPath}</p>
                    </div>
                    
                    <div class="server-backup-actions">
                        <button class="btn btn-primary" onclick="app.backupServer('${server.id}')">
                            <i class="fas fa-save"></i> Quick Backup
                        </button>
                        <button class="btn btn-info" onclick="app.showBackupModal('${server.id}')">
                            <i class="fas fa-cog"></i> Custom Backup
                        </button>
                        <button class="btn btn-secondary" onclick="app.viewServerBackups('${server.id}')">
                            <i class="fas fa-history"></i> View Backups
                        </button>
                    </div>
                </div>
            `;
        }

        backupsHtml += `
                </div>
            </div>
        `;

        container.innerHTML = backupsHtml;

        // Setup event listeners
        document.getElementById('createBackupAllBtn').addEventListener('click', () => this.backupAllServers());
        document.getElementById('cleanupBackupsBtn').addEventListener('click', () => this.cleanupAllBackups());
    }

    async backupAllServers() {
        const serversWithBackupPath = this.servers.filter(s => s.backupPath);
        
        if (serversWithBackupPath.length === 0) {
            this.showError('No servers have backup paths configured');
            return;
        }

        const confirmed = confirm(`Create backups for ${serversWithBackupPath.length} server(s)?`);
        if (!confirmed) return;

        this.showLoading(true);
        let successCount = 0;
        let errorCount = 0;

        for (const server of serversWithBackupPath) {
            try {
                const result = await ipcRenderer.invoke('create-backup', server.id, 'standard');
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                    console.error(`Backup failed for ${server.name}: ${result.error}`);
                }
            } catch (error) {
                errorCount++;
                console.error(`Backup error for ${server.name}:`, error);
            }
        }

        this.showLoading(false);
        
        if (errorCount === 0) {
            this.showSuccess(`All ${successCount} server backups completed successfully!`);
        } else {
            this.showError(`${successCount} backups completed, ${errorCount} failed. Check console for details.`);
        }
    }

    async cleanupAllBackups() {
        const serversWithBackupPath = this.servers.filter(s => s.backupPath);
        
        if (serversWithBackupPath.length === 0) {
            this.showError('No servers have backup paths configured');
            return;
        }

        const confirmed = confirm('Cleanup old backups for all servers? This will remove backups older than the retention period.');
        if (!confirmed) return;

        this.showLoading(true);
        let successCount = 0;
        let errorCount = 0;

        for (const server of serversWithBackupPath) {
            try {
                const result = await ipcRenderer.invoke('cleanup-old-backups', server.id);
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                    console.error(`Cleanup failed for ${server.name}: ${result.error}`);
                }
            } catch (error) {
                errorCount++;
                console.error(`Cleanup error for ${server.name}:`, error);
            }
        }

        this.showLoading(false);
        
        if (errorCount === 0) {
            this.showSuccess(`Backup cleanup completed for ${successCount} server(s)!`);
        } else {
            this.showError(`${successCount} cleanups completed, ${errorCount} failed. Check console for details.`);
        }
    }

    async viewServerBackups(serverId) {
        try {
            this.showLoading(true);
            const result = await ipcRenderer.invoke('list-backups', serverId);
            this.showLoading(false);

            if (!result.success) {
                this.showError(`Failed to list backups: ${result.error}`);
                return;
            }

            const server = this.servers.find(s => s.id === serverId);
            this.showBackupListModal(server, result.backups);
        } catch (error) {
            this.showLoading(false);
            this.showError(`Error listing backups: ${error.message}`);
        }
    }

    showBackupListModal(server, backups) {
        let backupListHtml = '';
        
        if (backups.length === 0) {
            backupListHtml = '<p class="text-muted">No backups found for this server</p>';
        } else {
            backupListHtml = `
                <div class="backup-list">
                    ${backups.map(backup => `
                        <div class="backup-item">
                            <div class="backup-details">
                                <h5>${backup.name}</h5>
                                <p><strong>Date:</strong> ${new Date(backup.date).toLocaleString()}</p>
                                <p><strong>Size:</strong> ${this.formatFileSize(backup.size)}</p>
                                <p><strong>Files:</strong> ${backup.fileCount}</p>
                                <p><strong>Path:</strong> ${backup.path}</p>
                            </div>
                            <div class="backup-actions">
                                <button class="btn btn-info" onclick="app.openBackupFolder('${backup.path}')">
                                    <i class="fas fa-folder-open"></i> Open
                                </button>
                                <button class="btn btn-warning" onclick="app.restoreBackup('${server.id}', '${backup.path}')">
                                    <i class="fas fa-undo"></i> Restore
                                </button>
                                <button class="btn btn-danger" onclick="app.deleteBackup('${backup.path}')">
                                    <i class="fas fa-trash"></i> Delete
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        const modalHtml = `
            <div id="backupListModal" class="modal" style="display: block;">
                <div class="modal-content large-modal">
                    <div class="modal-header">
                        <h3>Backups for ${server.name}</h3>
                        <span class="close" onclick="document.getElementById('backupListModal').remove()">&times;</span>
                    </div>
                    <div class="modal-body">
                        ${backupListHtml}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('backupListModal').remove()">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    async openBackupFolder(backupPath) {
        try {
            await ipcRenderer.invoke('open-folder', backupPath);
        } catch (error) {
            this.showError(`Failed to open backup folder: ${error.message}`);
        }
    }

    async restoreBackup(serverId, backupPath) {
        const confirmed = confirm('Are you sure you want to restore this backup? This will overwrite current server data.');
        if (!confirmed) return;

        try {
            this.showLoading(true);
            const result = await ipcRenderer.invoke('restore-backup', serverId, backupPath);
            this.showLoading(false);

            if (result.success) {
                this.showSuccess(`Backup restored successfully! ${result.filesRestored} files restored.`);
                document.getElementById('backupListModal').remove();
            } else {
                this.showError(`Failed to restore backup: ${result.error}`);
            }
        } catch (error) {
            this.showLoading(false);
            this.showError(`Error restoring backup: ${error.message}`);
        }
    }

    async deleteBackup(backupPath) {
        const confirmed = confirm('Are you sure you want to delete this backup? This action cannot be undone.');
        if (!confirmed) return;

        try {
            await ipcRenderer.invoke('delete-folder', backupPath);
            this.showSuccess('Backup deleted successfully');
            document.getElementById('backupListModal').remove();
        } catch (error) {
            this.showError(`Failed to delete backup: ${error.message}`);
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    renderLogs() {
        const container = document.getElementById('logs-container');
        // Implementation for log viewer
    }

    renderConsole() {
        const container = document.getElementById('console-container');
        // Implementation for SteamCMD console
    }

    showServerModal(server = null) {
        this.currentEditingServer = server;
        const modal = document.getElementById('serverModal');
        const title = document.getElementById('serverModalTitle');
        
        title.textContent = server ? 'Edit Server' : 'Add New Server';
        
        if (server) {
            this.populateServerForm(server);
        } else {
            this.clearServerForm();
        }
        
        modal.classList.add('show');
    }

    showSettingsModal() {
        const modal = document.getElementById('settingsModal');
        this.populateSettingsForm();
        modal.classList.add('show');
    }

    hideModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('show');
        });
        this.currentEditingServer = null;
    }

    populateServerForm(server) {
        document.getElementById('serverName').value = server.name || '';
        document.getElementById('instanceId').value = server.instanceId || '';
        document.getElementById('serverPath').value = server.serverPath || '';
        document.getElementById('port').value = server.port || 2302;
        document.getElementById('profileName').value = server.profileName || '';
        document.getElementById('configFile').value = server.configFile || 'serverDZ.cfg';
        document.getElementById('steamUsername').value = server.steamUsername || '';
        document.getElementById('steamPassword').value = server.steamPassword || '';
        document.getElementById('cpuCount').value = server.cpuCount || 4;
        document.getElementById('backupPath').value = server.backupPath || '';
        document.getElementById('keysPath').value = server.keysPath || '';
        
        if (server.mods) {
            const modList = server.mods.map(mod => `${mod.id},${mod.folderName}`).join('\n');
            document.getElementById('modList').value = modList;
        }

        // Populate launch parameters
        if (server.launchParams) {
            const params = server.launchParams;
            document.getElementById('profilesPath').value = params.profilesPath || 'ServerProfiles';
            document.getElementById('missionPath').value = params.missionPath || '';
            document.getElementById('doLogs').checked = params.doLogs !== false; // Default true
            document.getElementById('adminLog').checked = params.adminLog !== false; // Default true
            document.getElementById('netLog').checked = params.netLog || false;
            document.getElementById('freezeCheck').checked = params.freezeCheck !== false; // Default true
            document.getElementById('showScriptErrors').checked = params.showScriptErrors || false;
            document.getElementById('filePatching').checked = params.filePatching || false;
            document.getElementById('verifySignatures').value = params.verifySignatures || 2;
            document.getElementById('bePath').value = params.bePath || '';
            document.getElementById('restartTimer').value = params.restartTimer || 4;
            document.getElementById('limitFPS').value = params.limitFPS || '';
            document.getElementById('customParameters').value = params.customParameters || '';
        } else {
            // Set defaults for new servers
            document.getElementById('profilesPath').value = 'ServerProfiles';
            document.getElementById('missionPath').value = '';
            document.getElementById('doLogs').checked = true;
            document.getElementById('adminLog').checked = true;
            document.getElementById('netLog').checked = false;
            document.getElementById('freezeCheck').checked = true;
            document.getElementById('showScriptErrors').checked = false;
            document.getElementById('filePatching').checked = false;
            document.getElementById('verifySignatures').value = 2;
            document.getElementById('bePath').value = '';
            document.getElementById('restartTimer').value = 4;
            document.getElementById('limitFPS').value = '';
            document.getElementById('customParameters').value = '';
        }

        // Update the launch parameters preview
        this.updateLaunchParametersPreview();
    }

    clearServerForm() {
        document.getElementById('serverForm').reset();
        document.getElementById('port').value = 2302;
        document.getElementById('configFile').value = 'serverDZ.cfg';
        document.getElementById('cpuCount').value = 4;
        
        // Set default launch parameters
        document.getElementById('profilesPath').value = 'ServerProfiles';
        document.getElementById('doLogs').checked = true;
        document.getElementById('adminLog').checked = true;
        document.getElementById('netLog').checked = false;
        document.getElementById('freezeCheck').checked = true;
        document.getElementById('showScriptErrors').checked = false;
        document.getElementById('filePatching').checked = false;
        document.getElementById('verifySignatures').value = 2;
        document.getElementById('restartTimer').value = 4;
        
        // Update the launch parameters preview
        this.updateLaunchParametersPreview();
    }

    populateSettingsForm() {
        document.getElementById('steamCmdPath').value = this.settings.steamCmdPath || '';
        document.getElementById('workshopPath').value = this.settings.workshopPath || '';
        document.getElementById('steamWebApiKey').value = this.settings.steamWebApiKey || '';
        document.getElementById('steamUsername').value = this.settings.steamUsername || '';
        document.getElementById('steamPassword').value = this.settings.steamPassword || '';
        document.getElementById('backupRetentionDays').value = this.settings.backupRetentionDays || 5;
        document.getElementById('updateInterval').value = this.settings.updateInterval || '0 4 * * *';
        document.getElementById('autoBackup').checked = this.settings.autoBackup || false;
        document.getElementById('autoModUpdate').checked = this.settings.autoModUpdate || false;
        document.getElementById('checkModsOnStartup').checked = this.settings.checkModsOnStartup || false;
    }

    async saveServer() {
        try {
            this.showLoading(true);
            
            const formData = this.getServerFormData();
            const server = this.currentEditingServer 
                ? { ...this.currentEditingServer, ...formData }
                : formData;

            const savedServer = await ipcRenderer.invoke('save-server', server);
            
            if (this.currentEditingServer) {
                const index = this.servers.findIndex(s => s.id === savedServer.id);
                this.servers[index] = savedServer;
            } else {
                this.servers.push(savedServer);
            }
            
            this.renderServers();
            this.hideModals();
            this.showSuccess('Server saved successfully');
            
        } catch (error) {
            console.error('Error saving server:', error);
            this.showError('Failed to save server');
        } finally {
            this.showLoading(false);
        }
    }

    getServerFormData() {
        const modListText = document.getElementById('modList').value;
        const mods = modListText.split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [id, folderName] = line.split(',').map(s => s.trim());
                return { id, folderName };
            })
            .filter(mod => mod.id && mod.folderName); // Only include mods with both ID and folder name

        // Collect launch parameters
        const launchParams = {
            profilesPath: document.getElementById('profilesPath').value || 'ServerProfiles',
            missionPath: document.getElementById('missionPath').value || '',
            doLogs: document.getElementById('doLogs').checked,
            adminLog: document.getElementById('adminLog').checked,
            netLog: document.getElementById('netLog').checked,
            freezeCheck: document.getElementById('freezeCheck').checked,
            showScriptErrors: document.getElementById('showScriptErrors').checked,
            filePatching: document.getElementById('filePatching').checked,
            verifySignatures: parseInt(document.getElementById('verifySignatures').value),
            bePath: document.getElementById('bePath').value || '',
            restartTimer: parseInt(document.getElementById('restartTimer').value) || 0,
            limitFPS: parseInt(document.getElementById('limitFPS').value) || 0,
            customParameters: document.getElementById('customParameters').value || ''
        };

        return {
            name: document.getElementById('serverName').value,
            instanceId: parseInt(document.getElementById('instanceId').value),
            serverPath: document.getElementById('serverPath').value,
            port: parseInt(document.getElementById('port').value),
            profileName: document.getElementById('profileName').value,
            configFile: document.getElementById('configFile').value,
            steamUsername: document.getElementById('steamUsername').value,
            steamPassword: document.getElementById('steamPassword').value,
            cpuCount: parseInt(document.getElementById('cpuCount').value),
            backupPath: document.getElementById('backupPath').value,
            keysPath: document.getElementById('keysPath').value,
            mods: mods,
            launchParams: launchParams
        };
    }

    async saveSettings() {
        try {
            this.showLoading(true);
            
            const settingsData = {
                steamCmdPath: document.getElementById('steamCmdPath').value,
                workshopPath: document.getElementById('workshopPath').value,
                steamWebApiKey: document.getElementById('steamWebApiKey').value,
                steamUsername: document.getElementById('steamUsername').value,
                steamPassword: document.getElementById('steamPassword').value,
                backupRetentionDays: parseInt(document.getElementById('backupRetentionDays').value),
                updateInterval: document.getElementById('updateInterval').value,
                autoBackup: document.getElementById('autoBackup').checked,
                autoModUpdate: document.getElementById('autoModUpdate').checked,
                checkModsOnStartup: document.getElementById('checkModsOnStartup').checked
            };

            await ipcRenderer.invoke('save-settings', settingsData);
            this.settings = { ...this.settings, ...settingsData };
            
            this.hideModals();
            this.showSuccess('Settings saved successfully');
            
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showError('Failed to save settings');
        } finally {
            this.showLoading(false);
        }
    }

    async startServer(serverId) {
        try {
            this.showLoading(true);
            await ipcRenderer.invoke('start-server', serverId);
            this.showSuccess('Server started successfully');
        } catch (error) {
            console.error('Error starting server:', error);
            this.showError(`Failed to start server: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async stopServer(serverId) {
        try {
            this.showLoading(true);
            await ipcRenderer.invoke('stop-server', serverId);
            this.showSuccess('Server stopped successfully');
        } catch (error) {
            console.error('Error stopping server:', error);
            this.showError(`Failed to stop server: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async updateServerMods(serverId) {
        try {
            this.showLoading(true);
            await ipcRenderer.invoke('update-mods', serverId);
            this.showSuccess('Mods updated successfully');
        } catch (error) {
            console.error('Error updating mods:', error);
            this.showError(`Failed to update mods: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    async backupServer(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                this.showError('Server not found');
                return;
            }

            // Check if backup path is configured
            if (!server.backupPath) {
                const useCustomPath = confirm('No backup path configured for this server. Would you like to select a backup location?');
                if (useCustomPath) {
                    this.showBackupModal(serverId);
                    return;
                }
                this.showError('Please configure a backup path for this server first');
                return;
            }

            this.showLoading(true);
            const result = await ipcRenderer.invoke('create-backup', serverId, 'standard');
            
            if (result.success) {
                this.showSuccess(`Backup created successfully! ${result.filesBackedUp} files backed up to: ${result.backupDir}`);
            } else {
                this.showError(`Failed to create backup: ${result.error}`);
            }
        } catch (error) {
            console.error('Error creating backup:', error);
            this.showError(`Failed to create backup: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    showBackupModal(serverId) {
        const server = this.servers.find(s => s.id === serverId);
        if (!server) return;

        // Create backup modal HTML
        const modalHtml = `
            <div id="backupModal" class="modal" style="display: block;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Backup Server: ${server.name}</h3>
                        <span class="close" onclick="document.getElementById('backupModal').remove()">&times;</span>
                    </div>
                    <div class="modal-body">
                        <div class="backup-options">
                            <div class="form-group">
                                <label>Backup Type:</label>
                                <div class="backup-type-selection">
                                    <label>
                                        <input type="radio" name="backupType" value="standard" checked> 
                                        Standard Backup (Player data, saves, logs)
                                    </label>
                                    <label>
                                        <input type="radio" name="backupType" value="full"> 
                                        Full Backup (Entire server directory)
                                    </label>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="backupLocationPath">Backup Location:</label>
                                <div class="input-group">
                                    <input type="text" id="backupLocationPath" class="form-control" 
                                           value="${server.backupPath || ''}" placeholder="Select backup location...">
                                    <button type="button" class="btn btn-secondary" id="browseBackupLocation">
                                        <i class="fas fa-folder"></i> Browse
                                    </button>
                                </div>
                                <small class="form-text text-muted">Choose where to save the backup</small>
                            </div>
                            
                            <div class="backup-info">
                                <h4>What will be backed up:</h4>
                                <div id="backupDetails">
                                    <ul>
                                        <li>Player database (players.db)</li>
                                        <li>Dynamic event data</li>
                                        <li>Building persistence data</li>
                                        <li>Server logs and configuration</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('backupModal').remove()">Cancel</button>
                        <button type="button" class="btn btn-primary" id="startBackupBtn">
                            <i class="fas fa-save"></i> Create Backup
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add modal to DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Setup event listeners
        document.getElementById('browseBackupLocation').addEventListener('click', async () => {
            const path = await ipcRenderer.invoke('select-folder');
            if (path) {
                document.getElementById('backupLocationPath').value = path;
            }
        });

        // Update backup details based on type selection
        document.querySelectorAll('input[name="backupType"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const backupDetails = document.getElementById('backupDetails');
                if (radio.value === 'full') {
                    backupDetails.innerHTML = `
                        <ul>
                            <li><strong>Complete server directory</strong></li>
                            <li>All server files and folders</li>
                            <li>Configuration files</li>
                            <li>Mission files</li>
                            <li>Mod files (if stored in server directory)</li>
                            <li>Player data and persistence</li>
                            <li>Server logs and crash dumps</li>
                        </ul>
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-triangle"></i>
                            <strong>Note:</strong> Full backup may take significant time and disk space.
                        </div>
                    `;
                } else {
                    backupDetails.innerHTML = `
                        <ul>
                            <li>Player database (players.db)</li>
                            <li>Dynamic event data</li>
                            <li>Building persistence data</li>
                            <li>Server logs and configuration</li>
                        </ul>
                    `;
                }
            });
        });

        document.getElementById('startBackupBtn').addEventListener('click', async () => {
            const backupType = document.querySelector('input[name="backupType"]:checked').value;
            const backupPath = document.getElementById('backupLocationPath').value;

            if (!backupPath) {
                this.showError('Please select a backup location');
                return;
            }

            document.getElementById('backupModal').remove();
            await this.createBackupWithCustomPath(serverId, backupType, backupPath);
        });
    }

    async createBackupWithCustomPath(serverId, backupType, customPath) {
        try {
            this.showLoading(true);
            let result;
            
            if (backupType === 'full') {
                result = await ipcRenderer.invoke('create-full-backup-custom', serverId, customPath);
            } else {
                // For standard backup, temporarily update server's backup path
                const server = this.servers.find(s => s.id === serverId);
                const originalBackupPath = server.backupPath;
                server.backupPath = customPath;
                
                result = await ipcRenderer.invoke('create-backup', serverId, 'standard');
                
                // Restore original backup path
                server.backupPath = originalBackupPath;
            }
            
            if (result.success) {
                this.showSuccess(`${backupType === 'full' ? 'Full' : 'Standard'} backup created successfully! ${result.filesBackedUp} files backed up to: ${result.backupDir}`);
            } else {
                this.showError(`Failed to create backup: ${result.error}`);
            }
        } catch (error) {
            console.error('Error creating backup:', error);
            this.showError(`Failed to create backup: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    editServer(serverId) {
        const server = this.servers.find(s => s.id === serverId);
        if (server) {
            this.showServerModal(server);
        }
    }

    async deleteServer(serverId) {
        if (confirm('Are you sure you want to delete this server? This action cannot be undone.')) {
            try {
                this.showLoading(true);
                await ipcRenderer.invoke('delete-server', serverId);
                this.servers = this.servers.filter(s => s.id !== serverId);
                this.renderServers();
                this.showSuccess('Server deleted successfully');
            } catch (error) {
                console.error('Error deleting server:', error);
                this.showError(`Failed to delete server: ${error.message}`);
            } finally {
                this.showLoading(false);
            }
        }
    }

    async startAllServers() {
        for (const server of this.servers) {
            try {
                await this.startServer(server.id);
            } catch (error) {
                console.error(`Failed to start server ${server.name}:`, error);
            }
        }
    }

    async stopAllServers() {
        for (const server of this.servers) {
            try {
                await this.stopServer(server.id);
            } catch (error) {
                console.error(`Failed to stop server ${server.name}:`, error);
            }
        }
    }

    async updateAllMods() {
        for (const server of this.servers) {
            try {
                await this.updateServerMods(server.id);
            } catch (error) {
                console.error(`Failed to update mods for server ${server.name}:`, error);
            }
        }
    }

    getServerStatus(serverId) {
        // Return tracked status or default to 'stopped'
        return this.serverStatuses.get(serverId) || 'stopped';
    }

    updateServerStatus(serverId, status) {
        // Update tracked status
        this.serverStatuses.set(serverId, status);
        
        const serverElement = document.querySelector(`[data-server-id="${serverId}"]`);
        if (!serverElement) {
            // Server element not found, re-render all servers
            this.renderServers();
            return;
        }

        // Update status display
        const statusElement = serverElement.querySelector('.server-status');
        const startBtn = serverElement.querySelector('.start-btn');
        const stopBtn = serverElement.querySelector('.stop-btn');
        const resourcesElement = serverElement.querySelector('.server-resources');
        
        if (statusElement) {
            statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
            statusElement.className = `server-status status-${status}`;
        }
        
        // Update button visibility based on status
        if (startBtn && stopBtn) {
            if (status === 'running') {
                startBtn.style.display = 'none';
                stopBtn.style.display = 'inline-block';
            } else if (status === 'stopped') {
                startBtn.style.display = 'inline-block';
                stopBtn.style.display = 'none';
                // Clear resources when stopped
                if (resourcesElement) {
                    resourcesElement.remove();
                }
            } else if (status === 'starting') {
                startBtn.style.display = 'none';
                stopBtn.style.display = 'none';
                // Show starting indicator
                const actionsDiv = serverElement.querySelector('.server-actions');
                let startingBtn = actionsDiv.querySelector('.starting-btn');
                if (!startingBtn) {
                    startingBtn = document.createElement('button');
                    startingBtn.className = 'btn btn-warning starting-btn';
                    startingBtn.disabled = true;
                    startingBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
                    actionsDiv.insertBefore(startingBtn, actionsDiv.firstChild);
                }
            }
        }
        
        // Remove starting button if not starting
        if (status !== 'starting') {
            const startingBtn = serverElement.querySelector('.starting-btn');
            if (startingBtn) {
                startingBtn.remove();
            }
        }
    }

    updateServerResources(serverId, resources) {
        const serverElement = document.querySelector(`[data-server-id="${serverId}"]`);
        if (!serverElement) return;

        let resourcesElement = serverElement.querySelector('.server-resources');
        if (!resourcesElement) {
            // Create resources element if it doesn't exist
            resourcesElement = document.createElement('div');
            resourcesElement.className = 'server-resources';
            const serverInfo = serverElement.querySelector('.server-info');
            if (serverInfo) {
                serverInfo.appendChild(resourcesElement);
            } else {
                return;
            }
        }
        
        const { cpu, memory, uptime } = resources;
        const uptimeFormatted = this.formatUptime(uptime);
        
        resourcesElement.innerHTML = `
            <div class="resource-item">
                <i class="fas fa-microchip"></i>
                <span>CPU: ${cpu}%</span>
            </div>
            <div class="resource-item">
                <i class="fas fa-memory"></i>
                <span>RAM: ${memory} MB</span>
            </div>
            <div class="resource-item">
                <i class="fas fa-clock"></i>
                <span>Uptime: ${uptimeFormatted}</span>
            </div>
        `;
    }

    formatUptime(seconds) {
        if (seconds < 60) {
            return `${seconds}s`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        }
    }

    updateStartupStatus(message) {
        const statusBar = document.getElementById('startup-status');
        const statusText = document.getElementById('startup-status-text');
        const mainContent = document.querySelector('.main-content');
        
        // Special handling for rate limiting messages
        if (message.includes('rate limit') || message.includes('Rate Limit') || message.includes('code 5')) {
            statusText.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Steam Rate Limit Detected - Use manual mod copying instead`;
            statusBar.classList.add('show', 'warning');
            mainContent.classList.add('with-status');
            
            // Keep rate limit warning visible longer
            setTimeout(() => {
                statusBar.classList.remove('show', 'warning');
                mainContent.classList.remove('with-status');
            }, 10000); // 10 seconds
            return;
        }
        
        statusText.textContent = message;
        statusBar.classList.add('show');
        mainContent.classList.add('with-status');
        
        // Auto-hide after completion or error
        if (message.includes('completed') || message.includes('disabled') || message.includes('No servers')) {
            statusBar.classList.add('completed');
            setTimeout(() => {
                statusBar.classList.remove('show');
                mainContent.classList.remove('with-status');
            }, 3000);
        } else if (message.includes('Error') || message.includes('Failed')) {
            statusBar.classList.add('error');
            setTimeout(() => {
                statusBar.classList.remove('show');
                mainContent.classList.remove('with-status');
            }, 5000);
        }
    }

    async getModInfo(modId) {
        try {
            return await ipcRenderer.invoke('get-mod-info', modId);
        } catch (error) {
            console.error('Error getting mod info:', error);
            throw error;
        }
    }

    async checkModUpdates(serverId) {
        try {
            return await ipcRenderer.invoke('check-mod-updates', serverId);
        } catch (error) {
            console.error('Error checking mod updates:', error);
            throw error;
        }
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (show) {
            loading.classList.add('show');
        } else {
            loading.classList.remove('show');
        }
    }

    showSuccess(message) {
        // Show success message as an alert for now, could be enhanced with toast notifications
        console.log('Success:', message);
        alert(message);
    }

    showError(message) {
        // Check for rate limiting errors and provide helpful advice
        if (message.includes('rate limit') || message.includes('Rate Limit') || message.includes('code 5')) {
            const rateLimitMessage = `🚫 Steam Rate Limit Exceeded!\n\n` +
                `Steam has temporarily blocked further downloads. This is normal when downloading multiple mods quickly.\n\n` +
                `Solutions:\n` +
                `• Wait 10-15 minutes before trying again\n` +
                `• Use "Copy All Mods" to manually copy existing downloaded mods\n` +
                `• Disable "Check Mods on Startup" in Settings\n` +
                `• Update mods one at a time instead of all at once\n\n` +
                `The application will continue to work normally for other features.`;
            
            console.error('Rate Limit Error:', message);
            alert(rateLimitMessage);
        } else {
            // Regular error handling
            console.error('Error:', message);
            alert(message);
        }
    }

    // Progress Modal Methods
    setupProgressModal() {
        const cancelBtn = document.getElementById('cancelUpdateBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelModUpdate());
        }
        
        this.updateCancelled = false;
    }

    showProgressModal() {
        const modal = document.getElementById('modUpdateProgress');
        modal.classList.add('show');
        this.updateCancelled = false;
    }

    hideProgressModal() {
        const modal = document.getElementById('modUpdateProgress');
        modal.classList.remove('show');
    }

    updateProgress(current, total, currentMod) {
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        
        // Update progress bar
        const progressFill = document.getElementById('progressBarFill');
        const progressPercentage = document.getElementById('progressPercentage');
        const progressStats = document.getElementById('progressStats');
        const currentModText = document.getElementById('currentModText');
        
        if (progressFill) progressFill.style.width = `${percentage}%`;
        if (progressPercentage) progressPercentage.textContent = `${percentage}%`;
        if (progressStats) progressStats.textContent = `${current} / ${total} mods`;
        if (currentModText && currentMod) {
            currentModText.textContent = `Checking: ${currentMod.name || currentMod.id}`;
        }
    }

    addModToStatusList(mod, status = 'waiting') {
        const statusList = document.getElementById('modStatusList');
        if (!statusList) return;

        const statusItem = document.createElement('div');
        statusItem.className = `status-item ${status}`;
        statusItem.id = `status-${mod.id}`;
        
        let icon = 'fas fa-clock';
        let statusText = 'Waiting';
        
        switch (status) {
            case 'current':
                icon = 'fas fa-spinner fa-spin';
                statusText = 'Checking...';
                break;
            case 'completed':
                icon = 'fas fa-check';
                statusText = 'Completed';
                break;
            case 'error':
                icon = 'fas fa-exclamation-triangle';
                statusText = 'Error';
                break;
        }

        statusItem.innerHTML = `
            <div class="status-mod-info">
                <span class="status-mod-id">${mod.id}</span>
                <span class="status-mod-name">${mod.name || `Mod ${mod.id}`}</span>
            </div>
            <div class="status-indicator ${status}">
                <i class="${icon}"></i>
                <span>${statusText}</span>
            </div>
        `;

        statusList.appendChild(statusItem);
    }

    updateModStatus(modId, status, message = '') {
        const statusItem = document.getElementById(`status-${modId}`);
        if (!statusItem) return;

        // Remove all status classes and add new one
        statusItem.classList.remove('waiting', 'current', 'completed', 'error');
        statusItem.classList.add(status);

        const indicator = statusItem.querySelector('.status-indicator');
        const icon = statusItem.querySelector('.status-indicator i');
        const text = statusItem.querySelector('.status-indicator span');

        if (indicator) {
            indicator.classList.remove('waiting', 'current', 'completed', 'error');
            indicator.classList.add(status);
        }

        let iconClass = 'fas fa-clock';
        let statusText = 'Waiting';

        switch (status) {
            case 'current':
                iconClass = 'fas fa-spinner fa-spin';
                statusText = 'Checking...';
                break;
            case 'completed':
                iconClass = 'fas fa-check';
                statusText = message || 'Completed';
                break;
            case 'error':
                iconClass = 'fas fa-exclamation-triangle';
                statusText = message || 'Error';
                break;
        }

        if (icon) icon.className = iconClass;
        if (text) text.textContent = statusText;
    }

    clearModStatusList() {
        const statusList = document.getElementById('modStatusList');
        if (statusList) {
            statusList.innerHTML = '';
        }
    }

    async updateAllModsWithProgress() {
        if (this.servers.length === 0) {
            this.showError('No servers configured');
            return;
        }

        // Collect all unique mods
        const allMods = new Map();
        this.servers.forEach(server => {
            if (server.mods && server.mods.length > 0) {
                server.mods.forEach(mod => {
                    if (mod.id && !allMods.has(mod.id)) {
                        allMods.set(mod.id, mod);
                    }
                });
            }
        });

        if (allMods.size === 0) {
            this.showError('No mods configured to update');
            return;
        }

        this.showProgressModal();
        this.clearModStatusList();

        const mods = Array.from(allMods.values());
        let currentIndex = 0;

        // Initialize progress
        this.updateProgress(0, mods.length, null);

        // Add all mods to status list
        for (const mod of mods) {
            this.addModToStatusList(mod, 'waiting');
        }

        try {
            for (const mod of mods) {
                if (this.updateCancelled) {
                    this.showError('Mod update cancelled by user');
                    break;
                }

                // Update current mod status
                this.updateModStatus(mod.id, 'current');
                this.updateProgress(currentIndex, mods.length, mod);

                try {
                    // Get mod info first to show proper name
                    const modInfo = await ipcRenderer.invoke('get-mod-info', mod.id);
                    mod.name = modInfo.title;
                    
                    // Update the current mod text with proper name
                    const currentModText = document.getElementById('currentModText');
                    if (currentModText) {
                        currentModText.textContent = `Checking: ${mod.name || mod.id}`;
                    }

                    // Find servers that use this mod and update them
                    const serversWithMod = this.servers.filter(server => 
                        server.mods && server.mods.some(serverMod => serverMod.id === mod.id)
                    );

                    for (const server of serversWithMod) {
                        await ipcRenderer.invoke('update-mods', server.id);
                    }

                    this.updateModStatus(mod.id, 'completed', 'Up to date');
                } catch (error) {
                    console.error(`Error updating mod ${mod.id}:`, error);
                    this.updateModStatus(mod.id, 'error', error.message);
                }

                currentIndex++;
                this.updateProgress(currentIndex, mods.length, null);

                // Small delay to make progress visible
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (!this.updateCancelled) {
                this.showSuccess('All mods updated successfully');
                // Auto-close modal after success
                setTimeout(() => this.hideProgressModal(), 2000);
            }
        } catch (error) {
            console.error('Error during mod update:', error);
            this.showError(`Failed to update mods: ${error.message}`);
        } finally {
            if (!this.updateCancelled) {
                this.hideProgressModal();
            }
        }
    }

    cancelModUpdate() {
        this.updateCancelled = true;
        this.hideProgressModal();
    }

    showAddModModal() {
        // TODO: Implement add mod modal
        this.showError('Add mod feature coming soon');
    }

    async viewModLocation(modId) {
        try {
            console.log(`Opening location for mod ${modId}`);
            const result = await ipcRenderer.invoke('open-mod-location', modId);
            if (!result.success) {
                this.showError(`Failed to open mod location: ${result.error}`);
            }
        } catch (error) {
            console.error('Error opening mod location:', error);
            this.showError('Failed to open mod location');
        }
    }

    async showModCopyModal(modId) {
        try {
            // Get mod info first to get the title
            const modCard = document.getElementById(`mod-title-${modId}`);
            const modTitle = modCard ? modCard.textContent.replace(/^\s*(Loading...|⚠️|✅|❌)\s*/, '') : `Mod ${modId}`;
            
            // Get the source path for the mod
            const sourcePath = await ipcRenderer.invoke('get-mod-source-path', modId);
            
            // Get default copy location from settings
            const settings = await ipcRenderer.invoke('get-settings');
            
            // Populate modal with mod information
            document.getElementById('copyModTitle').textContent = modTitle;
            document.getElementById('copyModId').textContent = modId;
            document.getElementById('copyModFolder').textContent = `@${modId}`;
            document.getElementById('modSourcePath').value = sourcePath.path || '';
            document.getElementById('modDestinationPath').value = settings.defaultModCopyPath || '';
            
            // Reset status and options
            document.getElementById('copyStatus').style.display = 'none';
            document.getElementById('overwriteExisting').checked = true;
            document.getElementById('createSubfolder').checked = true;
            
            // Show the modal
            document.getElementById('modCopyModal').style.display = 'block';
            
            // Store current mod info for later use
            window.currentCopyMod = {
                id: modId,
                title: modTitle,
                sourcePath: sourcePath.path || ''
            };
            
        } catch (error) {
            console.error('Error showing mod copy modal:', error);
            this.showError('Failed to load mod information');
        }
    }

    async showCopyAllModsModal() {
        try {
            // Get all unique mods from all servers
            const allMods = await ipcRenderer.invoke('get-all-mods');
            const settings = await ipcRenderer.invoke('get-settings');
            
            // Populate modal with information
            document.getElementById('totalModCount').textContent = allMods.length;
            document.getElementById('allModsDestinationPath').value = settings.defaultModCopyPath || '';
            
            // Reset status and progress
            document.getElementById('copyAllProgress').style.display = 'none';
            document.getElementById('copyAllStatus').style.display = 'none';
            document.getElementById('overwriteExistingAll').checked = true;
            document.getElementById('createSubfolderAll').checked = true;
            document.getElementById('saveLocationSetting').checked = true;
            
            // Show the modal
            document.getElementById('copyAllModsModal').style.display = 'block';
            
            // Store mods for later use
            window.allModsToProcess = allMods;
            
        } catch (error) {
            console.error('Error showing copy all mods modal:', error);
            this.showError('Failed to load mod information');
        }
    }

    handleSteamCmdOutput(data) {
        // Handle SteamCMD output for real-time feedback
        console.log(`SteamCMD ${data.type}: ${data.data}`);
        
        // You could show this in a console tab or as notifications
        if (data.type === 'stderr' && data.data.includes('error')) {
            console.error(`SteamCMD Error for mod ${data.modId}: ${data.data}`);
        }
        
        // Update any progress indicators if needed
        if (data.data.includes('Update state (')) {
            // SteamCMD is showing download progress
            const progressMatch = data.data.match(/Update state \(0x\d+\) (.+)/);
            if (progressMatch) {
                console.log(`Download progress for mod ${data.modId}: ${progressMatch[1]}`);
            }
        }
        
        if (data.data.includes('Success.')) {
            console.log(`Mod ${data.modId} downloaded successfully`);
        }
    }

    async setServerKeysFolder(serverId) {
        try {
            // Find the server
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                this.showError('Server not found');
                return;
            }

            // Show folder selection dialog
            const result = await ipcRenderer.invoke('select-folder', 'Select Keys Folder');
            if (result && result.success) {
                // Update server configuration with keys path
                const updateResult = await ipcRenderer.invoke('update-server-keys-path', serverId, result.path);
                if (updateResult.success) {
                    server.keysPath = result.path;
                    this.renderServers(); // Refresh the UI
                    this.showSuccess('Keys folder path updated successfully');
                } else {
                    this.showError('Failed to update keys folder path');
                }
            }
        } catch (error) {
            console.error('Error setting keys folder:', error);
            this.showError('Failed to set keys folder');
        }
    }

    async pullModKeys(serverId) {
        try {
            // Find the server
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                this.showError('Server not found');
                return;
            }

            if (!server.keysPath) {
                this.showError('Please set a keys folder path first');
                return;
            }

            if (!server.mods || server.mods.length === 0) {
                this.showError('No mods configured for this server');
                return;
            }

            // Show progress modal
            this.showProgressModal();
            
            // Set up the modal for key pulling operation
            const progressStats = document.getElementById('progressStats');
            const currentModText = document.getElementById('currentModText');
            const progressBarFill = document.getElementById('progressBarFill');
            const progressPercentage = document.getElementById('progressPercentage');
            
            if (progressStats) progressStats.textContent = `Processing ${server.mods.length} mods...`;
            if (currentModText) currentModText.textContent = 'Initializing key extraction...';
            if (progressBarFill) progressBarFill.style.width = '10%';
            if (progressPercentage) progressPercentage.textContent = '10%';

            // Call the main process to pull mod keys
            const result = await ipcRenderer.invoke('pull-mod-keys', serverId);
            
            // Update progress to completion
            if (progressBarFill) progressBarFill.style.width = '100%';
            if (progressPercentage) progressPercentage.textContent = '100%';
            
            if (result.success) {
                const totalCopied = result.copiedKeys ? result.copiedKeys.length : 0;
                const totalErrors = result.errors ? result.errors.length : 0;
                const totalMods = server.mods.length;
                
                // Show completion message
                if (currentModText) {
                    if (totalCopied > 0) {
                        currentModText.textContent = `✅ Operation Complete! Found and copied ${totalCopied} key files from ${totalMods} mods`;
                    } else {
                        currentModText.textContent = `ℹ️ Operation Complete! No key files found in ${totalMods} mods (this is normal for many mods)`;
                    }
                }
                
                if (progressStats) {
                    let statsText = `✅ Completed: ${totalMods} mods processed`;
                    if (totalCopied > 0) statsText += ` • ${totalCopied} keys copied`;
                    if (totalErrors > 0) statsText += ` • ${totalErrors} errors`;
                    progressStats.textContent = statsText;
                }

                // Auto-hide modal after showing results
                setTimeout(() => {
                    this.hideProgressModal();
                    
                    // Show detailed success message
                    let message = `Key extraction completed!\n\n`;
                    message += `📊 Statistics:\n`;
                    message += `• Mods processed: ${totalMods}\n`;
                    message += `• Key files copied: ${totalCopied}\n`;
                    if (totalErrors > 0) {
                        message += `• Errors encountered: ${totalErrors}\n`;
                    }
                    message += `\n📁 Keys copied to: ${server.keysPath}`;
                    
                    if (totalErrors > 0 && result.errors) {
                        message += `\n\n⚠️ Errors:\n${result.errors.slice(0, 3).join('\n')}`;
                        if (result.errors.length > 3) {
                            message += `\n... and ${result.errors.length - 3} more (check console for details)`;
                        }
                    }
                    
                    this.showSuccess(message);
                }, 2000);
                
            } else {
                // Show error state
                if (currentModText) {
                    currentModText.textContent = `❌ Operation Failed: ${result.error}`;
                }
                if (progressStats) {
                    progressStats.textContent = `❌ Failed to pull mod keys`;
                }
                
                setTimeout(() => {
                    this.hideProgressModal();
                    this.showError(`Failed to pull mod keys: ${result.error}`);
                }, 2000);
            }
            
        } catch (error) {
            console.error('Error pulling mod keys:', error);
            this.hideProgressModal();
            this.showError('Failed to pull mod keys');
        }
    }

    async editServerConfig(serverId) {
        try {
            const server = this.servers.find(s => s.id === serverId);
            if (!server) {
                this.showError('Server not found');
                return;
            }

            if (!server.serverPath) {
                this.showError('Server path not configured');
                return;
            }

            this.showLoading(true);
            
            // Call the main process to open the config file
            const result = await ipcRenderer.invoke('edit-server-config', serverId);
            
            this.showLoading(false);
            
            if (result.success) {
                this.showSuccess(`Config file opened: ${result.configPath}`);
            } else {
                this.showError(`Failed to open config file: ${result.error}`);
            }
        } catch (error) {
            console.error('Error editing server config:', error);
            this.showLoading(false);
            this.showError('Failed to open config file');
        }
    }

    // Auto-updater methods
    async showUpdateAvailableModal(updateInfo) {
        const modal = document.getElementById('updateAvailableModal');
        const newVersionSpan = document.getElementById('newVersionNumber');
        const currentVersionSpan = document.getElementById('currentVersionNumber');
        const releaseDateSpan = document.getElementById('releaseDate');
        const releaseNotesContent = document.getElementById('releaseNotesContent');

        try {
            const currentVersion = await ipcRenderer.invoke('get-app-version');
            
            newVersionSpan.textContent = updateInfo.version;
            currentVersionSpan.textContent = currentVersion;
            releaseDateSpan.textContent = new Date(updateInfo.releaseDate).toLocaleDateString();
            
            // Handle release notes
            if (updateInfo.releaseNotes) {
                releaseNotesContent.innerHTML = updateInfo.releaseNotes;
            } else {
                releaseNotesContent.innerHTML = '<p>Release notes not available.</p>';
            }

            modal.classList.add('show');

            // Setup event listeners
            document.getElementById('updateLaterBtn').onclick = () => {
                modal.classList.remove('show');
            };

            document.getElementById('downloadUpdateBtn').onclick = async () => {
                modal.classList.remove('show');
                await this.downloadUpdate();
            };

        } catch (error) {
            console.error('Error showing update modal:', error);
        }
    }

    async downloadUpdate() {
        const progressModal = document.getElementById('updateProgressModal');
        progressModal.classList.add('show');

        try {
            await ipcRenderer.invoke('download-update');
        } catch (error) {
            console.error('Error downloading update:', error);
            progressModal.classList.remove('show');
            this.showError('Failed to download update: ' + error.message);
        }
    }

    updateDownloadProgress(progressObj) {
        const progressBar = document.getElementById('updateProgressBarFill');
        const progressPercentage = document.getElementById('updateProgressPercentage');
        const progressSpeed = document.getElementById('updateProgressSpeed');
        const downloadStats = document.getElementById('updateDownloadStats');

        if (progressBar) {
            progressBar.style.width = `${progressObj.percent}%`;
        }

        if (progressPercentage) {
            progressPercentage.textContent = `${Math.round(progressObj.percent)}%`;
        }

        if (progressSpeed) {
            const speedMB = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(1);
            progressSpeed.textContent = `${speedMB} MB/s`;
        }

        if (downloadStats) {
            const transferredMB = (progressObj.transferred / 1024 / 1024).toFixed(1);
            const totalMB = (progressObj.total / 1024 / 1024).toFixed(1);
            downloadStats.textContent = `Downloaded ${transferredMB} MB of ${totalMB} MB`;
        }
    }

    showUpdateReadyModal(updateInfo) {
        // Hide progress modal
        const progressModal = document.getElementById('updateProgressModal');
        progressModal.classList.remove('show');

        // Show ready modal
        const readyModal = document.getElementById('updateReadyModal');
        readyModal.classList.add('show');

        // Setup event listeners
        document.getElementById('installLaterBtn').onclick = () => {
            readyModal.classList.remove('show');
        };

        document.getElementById('installUpdateBtn').onclick = async () => {
            try {
                await ipcRenderer.invoke('install-update');
            } catch (error) {
                console.error('Error installing update:', error);
                this.showError('Failed to install update: ' + error.message);
            }
        };
    }

    async checkForUpdates() {
        try {
            console.log('Checking for updates...');
            const result = await ipcRenderer.invoke('check-for-updates');
            if (result && result.success === false) {
                this.showError(`Update check failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
            this.showError('Failed to check for updates: ' + error.message);
        }
    }
}

// Wait for DOM to be ready before initializing the application
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the main application
    const app = new DayZServerManagerUI();
    
    // Make app globally available for onclick handlers
    window.app = app;
    
    // Additional modal event handlers for copy functionality
    setupCopyModalEvents();
});

function setupCopyModalEvents() {
    // Close modals when clicking outside or on close button
    window.addEventListener('click', function(event) {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    });

    // Close buttons
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });

    // Mod copy modal event handlers
    const modCopyModal = document.getElementById('modCopyModal');
    const cancelCopyBtn = document.getElementById('cancelCopyBtn');
    const startCopyBtn = document.getElementById('startCopyBtn');
    const browseDestinationBtn = document.getElementById('browseDestinationBtn');
    const openSourceBtn = document.getElementById('openSourceBtn');

    // Copy all mods modal event handlers
    const copyAllModsModal = document.getElementById('copyAllModsModal');
    const copyAllModsBtn = document.getElementById('copyAllModsBtn');
    const cancelCopyAllBtn = document.getElementById('cancelCopyAllBtn');
    const startCopyAllBtn = document.getElementById('startCopyAllBtn');
    const browseAllModsDestinationBtn = document.getElementById('browseAllModsDestinationBtn');
    const browseDefaultModCopyPath = document.getElementById('browseDefaultModCopyPath');

    if (copyAllModsBtn) {
        copyAllModsBtn.addEventListener('click', function() {
            app.showCopyAllModsModal();
        });
    }

    if (browseDefaultModCopyPath) {
        browseDefaultModCopyPath.addEventListener('click', async function() {
            try {
                const result = await ipcRenderer.invoke('select-folder');
                if (result.success && result.path) {
                    document.getElementById('defaultModCopyPath').value = result.path;
                }
            } catch (error) {
                console.error('Error selecting default mod copy path:', error);
                app.showError('Failed to select folder');
            }
        });
    }

    if (cancelCopyBtn) {
        cancelCopyBtn.addEventListener('click', function() {
            modCopyModal.style.display = 'none';
        });
    }

    if (openSourceBtn) {
        openSourceBtn.addEventListener('click', async function() {
            if (window.currentCopyMod && window.currentCopyMod.sourcePath) {
                try {
                    await ipcRenderer.invoke('open-folder', window.currentCopyMod.sourcePath);
                } catch (error) {
                    console.error('Error opening source folder:', error);
                    app.showError('Failed to open source folder');
                }
            }
        });
    }

    if (browseDestinationBtn) {
        browseDestinationBtn.addEventListener('click', async function() {
            try {
                const result = await ipcRenderer.invoke('select-folder');
                if (result.success && result.path) {
                    document.getElementById('modDestinationPath').value = result.path;
                }
            } catch (error) {
                console.error('Error selecting destination folder:', error);
                app.showError('Failed to select destination folder');
            }
        });
    }

    if (startCopyBtn) {
        startCopyBtn.addEventListener('click', async function() {
            if (!window.currentCopyMod) return;

            const destinationPath = document.getElementById('modDestinationPath').value;
            if (!destinationPath) {
                app.showError('Please select a destination folder');
                return;
            }

            const overwriteExisting = document.getElementById('overwriteExisting').checked;
            const createSubfolder = document.getElementById('createSubfolder').checked;

            // Show copy status
            const copyStatus = document.getElementById('copyStatus');
            const copyStatusText = document.getElementById('copyStatusText');
            copyStatus.style.display = 'block';
            copyStatusText.textContent = 'Copying mod files...';
            copyStatus.querySelector('.alert').className = 'alert';

            // Disable buttons during copy
            startCopyBtn.disabled = true;
            cancelCopyBtn.disabled = true;

            try {
                const result = await ipcRenderer.invoke('copy-mod', {
                    modId: window.currentCopyMod.id,
                    sourcePath: window.currentCopyMod.sourcePath,
                    destinationPath: destinationPath,
                    overwriteExisting: overwriteExisting,
                    createSubfolder: createSubfolder
                });

                if (result.success) {
                    copyStatusText.textContent = `Mod copied successfully to: ${result.finalPath}`;
                    copyStatus.querySelector('.alert').className = 'alert success';
                    
                    // Auto-close modal after 2 seconds
                    setTimeout(() => {
                        modCopyModal.style.display = 'none';
                    }, 2000);
                } else {
                    copyStatusText.textContent = `Copy failed: ${result.error}`;
                    copyStatus.querySelector('.alert').className = 'alert error';
                }
            } catch (error) {
                console.error('Error copying mod:', error);
                copyStatusText.textContent = `Copy failed: ${error.message}`;
                copyStatus.querySelector('.alert').className = 'alert error';
            } finally {
                // Re-enable buttons
                startCopyBtn.disabled = false;
                cancelCopyBtn.disabled = false;
            }
        });
    }

    // Copy all mods functionality
    if (cancelCopyAllBtn) {
        cancelCopyAllBtn.addEventListener('click', function() {
            copyAllModsModal.style.display = 'none';
        });
    }

    if (browseAllModsDestinationBtn) {
        browseAllModsDestinationBtn.addEventListener('click', async function() {
            try {
                const result = await ipcRenderer.invoke('select-folder');
                if (result.success && result.path) {
                    document.getElementById('allModsDestinationPath').value = result.path;
                }
            } catch (error) {
                console.error('Error selecting destination folder:', error);
                app.showError('Failed to select destination folder');
            }
        });
    }

    if (startCopyAllBtn) {
        startCopyAllBtn.addEventListener('click', async function() {
            if (!window.allModsToProcess || window.allModsToProcess.length === 0) {
                app.showError('No mods to copy');
                return;
            }

            const destinationPath = document.getElementById('allModsDestinationPath').value;
            if (!destinationPath) {
                app.showError('Please select a destination folder');
                return;
            }

            const overwriteExisting = document.getElementById('overwriteExistingAll').checked;
            const createSubfolder = document.getElementById('createSubfolderAll').checked;
            const saveLocationSetting = document.getElementById('saveLocationSetting').checked;

            // Save the location in settings if requested
            if (saveLocationSetting) {
                try {
                    await ipcRenderer.invoke('update-setting', 'defaultModCopyPath', destinationPath);
                } catch (error) {
                    console.warn('Failed to save default mod copy path:', error);
                }
            }

            // Show progress
            const copyAllProgress = document.getElementById('copyAllProgress');
            const copyAllStatus = document.getElementById('copyAllStatus');
            const copyAllStatusText = document.getElementById('copyAllStatusText');
            const progressBarFill = document.getElementById('copyAllProgressBarFill');
            const progressPercentage = document.getElementById('copyAllProgressPercentage');
            const currentCopyText = document.getElementById('currentCopyText');

            copyAllProgress.style.display = 'block';
            copyAllStatus.style.display = 'none';
            progressBarFill.style.width = '0%';
            progressPercentage.textContent = '0%';
            currentCopyText.textContent = 'Starting copy process...';

            // Disable buttons during copy
            startCopyAllBtn.disabled = true;
            cancelCopyAllBtn.disabled = true;

            try {
                const totalMods = window.allModsToProcess.length;
                let completedMods = 0;
                let failedMods = [];

                for (const mod of window.allModsToProcess) {
                    try {
                        currentCopyText.textContent = `Copying ${mod.folderName || `@${mod.id}`}...`;

                        const result = await ipcRenderer.invoke('copy-mod', {
                            modId: mod.id,
                            sourcePath: mod.sourcePath,
                            destinationPath: destinationPath,
                            overwriteExisting: overwriteExisting,
                            createSubfolder: createSubfolder
                        });

                        if (!result.success) {
                            failedMods.push({ mod: mod, error: result.error });
                        }

                        completedMods++;
                        const progress = Math.round((completedMods / totalMods) * 100);
                        progressBarFill.style.width = `${progress}%`;
                        progressPercentage.textContent = `${progress}%`;

                    } catch (error) {
                        failedMods.push({ mod: mod, error: error.message });
                        completedMods++;
                    }
                }

                // Show completion status
                copyAllProgress.style.display = 'none';
                copyAllStatus.style.display = 'block';

                if (failedMods.length === 0) {
                    copyAllStatusText.textContent = `All ${totalMods} mods copied successfully!`;
                    copyAllStatus.querySelector('.alert').className = 'alert success';
                    
                    // Auto-close modal after 3 seconds
                    setTimeout(() => {
                        copyAllModsModal.style.display = 'none';
                    }, 3000);
                } else {
                    const successfulMods = totalMods - failedMods.length;
                    copyAllStatusText.textContent = `${successfulMods} of ${totalMods} mods copied. ${failedMods.length} failed.`;
                    copyAllStatus.querySelector('.alert').className = 'alert warning';
                    console.warn('Failed mods:', failedMods);
                }

            } catch (error) {
                console.error('Error during bulk copy:', error);
                copyAllProgress.style.display = 'none';
                copyAllStatus.style.display = 'block';
                copyAllStatusText.textContent = `Copy operation failed: ${error.message}`;
                copyAllStatus.querySelector('.alert').className = 'alert error';
            } finally {
                // Re-enable buttons
                startCopyAllBtn.disabled = false;
                cancelCopyAllBtn.disabled = false;
            }
        });
    }
}

