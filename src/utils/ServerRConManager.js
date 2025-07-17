const path = require('path');
const fs = require('fs').promises;
const BattlEyeRCon = require('./BattlEyeRCon');

class ServerRConManager {
    constructor() {
        this.rconConnections = new Map(); // serverId -> RCon instance
        this.restartTimers = new Map(); // serverId -> timer info
        this.warningTimers = new Map(); // serverId -> warning timers
    }

    // Initialize RCon connection for a server
    async initializeRCon(server) {
        try {
            if (!server.rconPassword) {
                console.warn(`Server ${server.name} has no RCon password configured`);
                return false;
            }

            // Use configured RCon port or default to game port + 1
            const rconPort = server.rconPort || (parseInt(server.port) + 1);
            
            const rcon = new BattlEyeRCon('127.0.0.1', rconPort, server.rconPassword);
            
            // Set up message handler for server messages
            rcon.onMessage((message) => {
                console.log(`[${server.name}] Server message: ${message}`);
                // You can emit events here to notify the UI
                if (global.mainWindow) {
                    global.mainWindow.webContents.send('rcon-message', {
                        serverId: server.id,
                        message: message,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            await rcon.connect();
            this.rconConnections.set(server.id, rcon);
            
            console.log(`RCon connected for server ${server.name}`);
            return true;
        } catch (error) {
            console.error(`Failed to connect RCon for server ${server.name}:`, error);
            return false;
        }
    }

    // Get RCon connection for a server
    getRCon(serverId) {
        return this.rconConnections.get(serverId);
    }

    // Disconnect RCon for a server
    disconnectRCon(serverId) {
        const rcon = this.rconConnections.get(serverId);
        if (rcon) {
            rcon.disconnect();
            this.rconConnections.delete(serverId);
        }
    }

    // Setup restart schedule for a server
    setupRestartSchedule(server) {
        // Clear existing timers
        this.clearRestartTimers(server.id);

        if (!server.restartScheduler || !server.restartScheduler.enabled || !server.restartScheduler.times) {
            return;
        }

        const timers = [];
        const warningTimers = [];

        server.restartScheduler.times.forEach(timeString => {
            const [hours, minutes] = timeString.split(':').map(Number);
            
            // Schedule restart
            const restartTimer = this.scheduleDaily(hours, minutes, async () => {
                await this.executeScheduledRestart(server);
            });
            
            timers.push(restartTimer);

            // Schedule warning if enabled
            if (server.restartScheduler.warningTime > 0) {
                const warningMinutes = minutes - server.restartScheduler.warningTime;
                let warningHours = hours;
                
                if (warningMinutes < 0) {
                    warningHours = hours - 1;
                    const adjustedWarningMinutes = 60 + warningMinutes;
                    
                    if (warningHours < 0) {
                        warningHours = 23;
                    }
                    
                    const warningTimer = this.scheduleDaily(warningHours, adjustedWarningMinutes, async () => {
                        await this.sendRestartWarning(server);
                    });
                    
                    warningTimers.push(warningTimer);
                } else {
                    const warningTimer = this.scheduleDaily(warningHours, warningMinutes, async () => {
                        await this.sendRestartWarning(server);
                    });
                    
                    warningTimers.push(warningTimer);
                }
            }
        });

        this.restartTimers.set(server.id, timers);
        this.warningTimers.set(server.id, warningTimers);
    }

    // Schedule a daily recurring task
    scheduleDaily(hours, minutes, callback) {
        const now = new Date();
        const scheduledTime = new Date();
        scheduledTime.setHours(hours, minutes, 0, 0);

        // If the time has already passed today, schedule for tomorrow
        if (scheduledTime <= now) {
            scheduledTime.setDate(scheduledTime.getDate() + 1);
        }

        const timeUntilExecution = scheduledTime.getTime() - now.getTime();

        const timeout = setTimeout(() => {
            callback();
            
            // Schedule the next occurrence (24 hours later)
            const interval = setInterval(callback, 24 * 60 * 60 * 1000);
            
            // Store the interval for cleanup
            if (timeout._scheduledInterval) {
                clearInterval(timeout._scheduledInterval);
            }
            timeout._scheduledInterval = interval;
        }, timeUntilExecution);

        return timeout;
    }

    // Execute scheduled restart
    async executeScheduledRestart(server) {
        const rcon = this.getRCon(server.id);
        if (!rcon) {
            console.error(`No RCon connection for server ${server.name}`);
            return;
        }

        try {
            const message = server.restartScheduler.restartMessage || 'Scheduled server restart';
            await rcon.restartServer(message, 0);
            
            console.log(`Scheduled restart executed for server ${server.name}`);
            
            // Notify UI
            if (global.mainWindow) {
                global.mainWindow.webContents.send('scheduled-restart-executed', {
                    serverId: server.id,
                    serverName: server.name,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error(`Failed to execute scheduled restart for server ${server.name}:`, error);
        }
    }

    // Send restart warning
    async sendRestartWarning(server) {
        const rcon = this.getRCon(server.id);
        if (!rcon) {
            console.error(`No RCon connection for server ${server.name}`);
            return;
        }

        try {
            const warningTime = server.restartScheduler.warningTime || 15;
            let message = server.restartScheduler.restartMessage || 'Server restart in {time} minutes. Please find a safe location.';
            message = message.replace('{time}', warningTime.toString());
            
            await rcon.say(message);
            
            console.log(`Restart warning sent for server ${server.name}: ${message}`);
        } catch (error) {
            console.error(`Failed to send restart warning for server ${server.name}:`, error);
        }
    }

    // Clear restart timers for a server
    clearRestartTimers(serverId) {
        const timers = this.restartTimers.get(serverId);
        if (timers) {
            timers.forEach(timer => {
                clearTimeout(timer);
                if (timer._scheduledInterval) {
                    clearInterval(timer._scheduledInterval);
                }
            });
            this.restartTimers.delete(serverId);
        }

        const warningTimers = this.warningTimers.get(serverId);
        if (warningTimers) {
            warningTimers.forEach(timer => {
                clearTimeout(timer);
                if (timer._scheduledInterval) {
                    clearInterval(timer._scheduledInterval);
                }
            });
            this.warningTimers.delete(serverId);
        }
    }

    // Manual restart with warning
    async restartServerWithWarning(serverId, warningMinutes = 5, restartMessage = 'Server restart in {time} minutes') {
        const rcon = this.getRCon(serverId);
        if (!rcon) {
            throw new Error('RCon not connected for this server');
        }

        try {
            // Send warning message
            let message = restartMessage.replace('{time}', warningMinutes.toString());
            await rcon.say(message);

            // Schedule restart after warning period
            setTimeout(async () => {
                try {
                    await rcon.restartServer('Server restart', 0);
                } catch (error) {
                    console.error('Failed to execute restart:', error);
                }
            }, warningMinutes * 60 * 1000);

            return { success: true, message: `Restart scheduled in ${warningMinutes} minutes` };
        } catch (error) {
            throw new Error(`Failed to schedule restart: ${error.message}`);
        }
    }

    // Send message to all players
    async broadcastMessage(serverId, message) {
        const rcon = this.getRCon(serverId);
        if (!rcon) {
            throw new Error('RCon not connected for this server');
        }

        try {
            await rcon.say(message);
            return { success: true, message: 'Message broadcasted successfully' };
        } catch (error) {
            throw new Error(`Failed to broadcast message: ${error.message}`);
        }
    }

    // Get player list
    async getPlayers(serverId) {
        const rcon = this.getRCon(serverId);
        if (!rcon) {
            throw new Error('RCon not connected for this server');
        }

        try {
            const response = await rcon.getPlayers();
            return { success: true, players: response };
        } catch (error) {
            throw new Error(`Failed to get player list: ${error.message}`);
        }
    }

    // Kick player
    async kickPlayer(serverId, playerId, reason = 'Kicked by admin') {
        const rcon = this.getRCon(serverId);
        if (!rcon) {
            throw new Error('RCon not connected for this server');
        }

        try {
            await rcon.kickPlayer(playerId, reason);
            return { success: true, message: `Player ${playerId} kicked successfully` };
        } catch (error) {
            throw new Error(`Failed to kick player: ${error.message}`);
        }
    }

    // Wipe server storage folder
    async wipeServerStorage(server) {
        try {
            if (!server.serverPath) {
                throw new Error('Server path not configured');
            }

            // Construct storage path based on server configuration
            const missionPath = server.missionPath || 'dayzOffline.chernarusplus';
            const profilesPath = server.profilesPath || 'ServerProfiles';
            
            // Try different possible storage folder locations
            const possibleStoragePaths = [
                path.join(server.serverPath, profilesPath, server.profileName, 'storage_1'),
                path.join(server.serverPath, 'mpmissions', missionPath, 'storage_1'),
                path.join(server.serverPath, 'Server', server.profileName, 'mpmissions', missionPath, 'storage_1'),
                path.join(server.serverPath, 'Server', `Server ${server.instanceId}`, 'mpmissions', missionPath, 'storage_1')
            ];

            let storageFound = false;
            let wipedPath = '';

            for (const storagePath of possibleStoragePaths) {
                try {
                    const stats = await fs.stat(storagePath);
                    if (stats.isDirectory()) {
                        // Remove all files and subdirectories in storage folder
                        const items = await fs.readdir(storagePath);
                        
                        for (const item of items) {
                            const itemPath = path.join(storagePath, item);
                            const itemStats = await fs.stat(itemPath);
                            
                            if (itemStats.isDirectory()) {
                                await fs.rmdir(itemPath, { recursive: true });
                            } else {
                                await fs.unlink(itemPath);
                            }
                        }
                        
                        storageFound = true;
                        wipedPath = storagePath;
                        break;
                    }
                } catch (error) {
                    // Path doesn't exist or not accessible, try next one
                    continue;
                }
            }

            if (!storageFound) {
                throw new Error('Storage folder not found. Please check server configuration.');
            }

            console.log(`Wiped storage folder for server ${server.name}: ${wipedPath}`);
            
            return { 
                success: true, 
                message: `Storage folder wiped successfully: ${wipedPath}`,
                path: wipedPath 
            };
        } catch (error) {
            throw new Error(`Failed to wipe storage folder: ${error.message}`);
        }
    }

    // Cleanup - disconnect all RCon connections
    cleanup() {
        for (const [serverId, rcon] of this.rconConnections) {
            rcon.disconnect();
            this.clearRestartTimers(serverId);
        }
        this.rconConnections.clear();
        this.restartTimers.clear();
        this.warningTimers.clear();
    }
}

module.exports = ServerRConManager;
