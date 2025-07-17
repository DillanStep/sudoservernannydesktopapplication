const fs = require('fs-extra');
const path = require('path');

class BackupManager {
    constructor(settings) {
        this.settings = settings;
    }

    /**
     * Create a comprehensive backup of the entire server directory
     */
    async createFullBackup(server, customBackupPath = null) {
        const timestamp = this.generateTimestamp();
        const backupBasePath = customBackupPath || server.backupPath;
        const backupDir = path.join(backupBasePath, `${server.profileName}_full_backup`, timestamp);
        
        console.log(`Creating full backup for ${server.name} at ${backupDir}`);
        
        await fs.ensureDir(backupDir);
        
        const serverPath = server.serverPath;
        
        // Create subdirectories in backup
        const backupServerDir = path.join(backupDir, 'server');
        const backupConfigDir = path.join(backupDir, 'config');
        
        await fs.ensureDir(backupServerDir);
        await fs.ensureDir(backupConfigDir);
        
        let totalFilesCopied = 0;
        
        try {
            // Backup the entire server directory except for temp files and logs
            console.log('Backing up server directory...');
            const serverFilesCopied = await this.copyDirectorySelective(
                serverPath, 
                backupServerDir,
                {
                    exclude: ['*.tmp', '*.log', '*.mdmp', 'DayZServer_*.ADM', 'cache/*'],
                    includeHidden: false
                }
            );
            totalFilesCopied += serverFilesCopied;
            
            // Backup server configuration files
            console.log('Backing up configuration files...');
            const configFiles = [
                path.join(serverPath, server.configFile || 'serverDZ.cfg'),
                path.join(serverPath, 'basic.cfg'),
                path.join(serverPath, 'BEServer_x64.cfg'),
                path.join(serverPath, 'types.xml'),
                path.join(serverPath, 'cfgeconomycore.xml'),
                path.join(serverPath, 'globals.xml'),
                path.join(serverPath, 'events.xml'),
                path.join(serverPath, 'spawnabletypes.xml'),
                path.join(serverPath, 'messages.xml')
            ];
            
            for (const configFile of configFiles) {
                if (await fs.pathExists(configFile)) {
                    const fileName = path.basename(configFile);
                    await fs.copy(configFile, path.join(backupConfigDir, fileName));
                    totalFilesCopied++;
                }
            }
            
            // Create backup info file
            const backupInfo = {
                serverName: server.name,
                serverId: server.id,
                backupDate: new Date().toISOString(),
                backupType: 'full',
                serverPath: serverPath,
                profileName: server.profileName,
                totalFiles: totalFilesCopied,
                version: '1.0'
            };
            
            await fs.writeJSON(path.join(backupDir, 'backup_info.json'), backupInfo, { spaces: 2 });
            
            console.log(`Full backup completed: ${totalFilesCopied} files backed up to ${backupDir}`);
            return { backupDir, filesBackedUp: totalFilesCopied, backupInfo };
            
        } catch (error) {
            console.error('Error during full backup:', error);
            throw error;
        }
    }

    /**
     * Copy directory with selective filtering
     */
    async copyDirectorySelective(srcDir, destDir, options = {}) {
        const { exclude = [], includeHidden = false } = options;
        let filesCopied = 0;
        
        if (!await fs.pathExists(srcDir)) {
            return filesCopied;
        }
        
        await fs.ensureDir(destDir);
        
        const items = await fs.readdir(srcDir);
        
        for (const item of items) {
            const srcPath = path.join(srcDir, item);
            const destPath = path.join(destDir, item);
            const stat = await fs.stat(srcPath);
            
            // Skip hidden files if not included
            if (!includeHidden && item.startsWith('.')) {
                continue;
            }
            
            // Check exclusion patterns
            const shouldExclude = exclude.some(pattern => {
                if (pattern.includes('*')) {
                    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                    return regex.test(item);
                }
                return item === pattern || srcPath.includes(pattern);
            });
            
            if (shouldExclude) {
                continue;
            }
            
            if (stat.isDirectory()) {
                const subFilesCopied = await this.copyDirectorySelective(srcPath, destPath, options);
                filesCopied += subFilesCopied;
            } else {
                await fs.copy(srcPath, destPath);
                filesCopied++;
            }
        }
        
        return filesCopied;
    }

    /**
     * Create a backup of server data
     */
    async createBackup(server) {
        const timestamp = this.generateTimestamp();
        const backupDir = path.join(server.backupPath, server.profileName, timestamp);
        
        console.log(`Creating backup for ${server.name} at ${backupDir}`);
        
        await fs.ensureDir(backupDir);
        
        const serverPath = server.serverPath;
        const profilePath = path.join(serverPath, server.profileName);
        const missionPath = path.join(serverPath, 'mpmissions', 'dayz.chernarus', `storage_${server.instanceId}`);
        
        // Files to backup
        const backupTasks = [
            // Player database
            {
                source: path.join(missionPath, 'players.db'),
                dest: path.join(backupDir, 'players.db')
            },
            // Dynamic data files
            {
                source: path.join(missionPath, 'data', 'dynamic_*.bin'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(missionPath, 'data', 'dynamic_*.001'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(missionPath, 'data', 'dynamic_*.002'),
                dest: backupDir,
                pattern: true
            },
            // Building data
            {
                source: path.join(missionPath, 'data', 'building*.bin'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(missionPath, 'data', 'building*.001'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(missionPath, 'data', 'building*.002'),
                dest: backupDir,
                pattern: true
            },
            // Other data files
            {
                source: path.join(missionPath, 'data', 'events.bin'),
                dest: path.join(backupDir, 'events.bin')
            },
            {
                source: path.join(missionPath, 'data', 'types.bin'),
                dest: path.join(backupDir, 'types.bin')
            },
            {
                source: path.join(missionPath, 'data', 'vehicles.bin'),
                dest: path.join(backupDir, 'vehicles.bin')
            },
            // Log files
            {
                source: path.join(profilePath, 'error*.log'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(profilePath, 'RFFSHeli*.log'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(profilePath, 'info*.log'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(profilePath, 'script*.log'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(profilePath, 'crash*.log'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(profilePath, 'serverconsole.log'),
                dest: path.join(backupDir, 'serverconsole.log')
            },
            {
                source: path.join(profilePath, 'DayZServer*.ADM'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(profilePath, 'ErrorMessage*.mdmp'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(profilePath, 'DayZServer*.rpt'),
                dest: backupDir,
                pattern: true
            },
            {
                source: path.join(profilePath, 'LBmaster*.log'),
                dest: backupDir,
                pattern: true
            }
        ];

        let filesBackedUp = 0;
        
        for (const task of backupTasks) {
            try {
                if (task.pattern) {
                    filesBackedUp += await this.backupPatternFiles(task.source, task.dest);
                } else {
                    if (await fs.pathExists(task.source)) {
                        await fs.copy(task.source, task.dest);
                        filesBackedUp++;
                    }
                }
            } catch (error) {
                console.warn(`Failed to backup ${task.source}:`, error.message);
            }
        }

        console.log(`Backup completed: ${filesBackedUp} files backed up to ${backupDir}`);
        return { backupDir, filesBackedUp };
    }

    /**
     * Backup files matching a pattern
     */
    async backupPatternFiles(sourcePattern, destDir) {
        const sourceDir = path.dirname(sourcePattern);
        const pattern = path.basename(sourcePattern);
        
        if (!await fs.pathExists(sourceDir)) {
            return 0;
        }

        const files = await fs.readdir(sourceDir);
        const matchingFiles = files.filter(file => this.matchesPattern(file, pattern));
        
        let count = 0;
        for (const file of matchingFiles) {
            const sourcePath = path.join(sourceDir, file);
            const destPath = path.join(destDir, file);
            await fs.copy(sourcePath, destPath);
            count++;
        }
        
        return count;
    }

    /**
     * Clean up old backups based on retention policy
     */
    async cleanupOldBackups(backupPath, retentionDays = null) {
        const retention = retentionDays || this.settings.backupRetentionDays || 5;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retention);
        
        console.log(`Cleaning up backups older than ${retention} days`);
        
        try {
            if (!await fs.pathExists(backupPath)) {
                return;
            }

            const servers = await fs.readdir(backupPath);
            
            for (const serverDir of servers) {
                const serverBackupPath = path.join(backupPath, serverDir);
                const stat = await fs.stat(serverBackupPath);
                
                if (stat.isDirectory()) {
                    const backups = await fs.readdir(serverBackupPath);
                    
                    for (const backup of backups) {
                        const backupFullPath = path.join(serverBackupPath, backup);
                        const backupStat = await fs.stat(backupFullPath);
                        
                        if (backupStat.isDirectory() && backupStat.mtime < cutoffDate) {
                            await fs.remove(backupFullPath);
                            console.log(`Removed old backup: ${backupFullPath}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error cleaning up old backups:', error);
        }
    }

    /**
     * Restore a backup
     */
    async restoreBackup(server, backupPath) {
        console.log(`Restoring backup from ${backupPath} for server ${server.name}`);
        
        if (!await fs.pathExists(backupPath)) {
            throw new Error(`Backup path does not exist: ${backupPath}`);
        }

        const serverPath = server.serverPath;
        const profilePath = path.join(serverPath, server.profileName);
        const missionPath = path.join(serverPath, 'mpmissions', 'dayz.chernarus', `storage_${server.instanceId}`);
        
        // Ensure destination directories exist
        await fs.ensureDir(profilePath);
        await fs.ensureDir(path.join(missionPath, 'data'));
        
        // Restore files
        const backupFiles = await fs.readdir(backupPath);
        let filesRestored = 0;
        
        for (const file of backupFiles) {
            const sourceFile = path.join(backupPath, file);
            let destFile;
            
            // Determine destination based on file type
            if (file === 'players.db') {
                destFile = path.join(missionPath, file);
            } else if (file.includes('dynamic_') || file.includes('building') || 
                      file.includes('events.bin') || file.includes('types.bin') || 
                      file.includes('vehicles.bin')) {
                destFile = path.join(missionPath, 'data', file);
            } else {
                destFile = path.join(profilePath, file);
            }
            
            try {
                await fs.copy(sourceFile, destFile, { overwrite: true });
                filesRestored++;
            } catch (error) {
                console.warn(`Failed to restore ${file}:`, error.message);
            }
        }
        
        console.log(`Restore completed: ${filesRestored} files restored`);
        return { filesRestored };
    }

    /**
     * List available backups for a server
     */
    async listBackups(server) {
        const serverBackupPath = path.join(server.backupPath, server.profileName);
        
        if (!await fs.pathExists(serverBackupPath)) {
            return [];
        }
        
        const backups = await fs.readdir(serverBackupPath);
        const backupInfo = [];
        
        for (const backup of backups) {
            const backupPath = path.join(serverBackupPath, backup);
            const stat = await fs.stat(backupPath);
            
            if (stat.isDirectory()) {
                const files = await fs.readdir(backupPath);
                backupInfo.push({
                    name: backup,
                    path: backupPath,
                    date: stat.mtime,
                    size: await this.getDirectorySize(backupPath),
                    fileCount: files.length
                });
            }
        }
        
        // Sort by date, newest first
        return backupInfo.sort((a, b) => b.date.getTime() - a.date.getTime());
    }

    /**
     * Calculate directory size
     */
    async getDirectorySize(dirPath) {
        let size = 0;
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stat = await fs.stat(filePath);
            size += stat.size;
        }
        
        return size;
    }

    /**
     * Generate timestamp for backup directory name
     */
    generateTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        
        return `${year}${month}${day}_${hour}${minute}_${second}`;
    }

    /**
     * Simple pattern matching for wildcards
     */
    matchesPattern(filename, pattern) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(filename);
    }
}

module.exports = BackupManager;
