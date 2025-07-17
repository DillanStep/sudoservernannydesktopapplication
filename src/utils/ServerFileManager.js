const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

class ServerFileManager {
    constructor(settings) {
        this.settings = settings;
    }

    /**
     * Sync server files from SteamCMD download location to server directory
     */
    async syncServerFiles(serverPath) {
        const sourceServerPath = path.join(this.settings.steamCmdPath, 'steamapps', 'common', 'DayZServer');
        
        if (!await fs.pathExists(sourceServerPath)) {
            throw new Error(`Server source files not found at: ${sourceServerPath}`);
        }

        console.log(`Syncing server files from ${sourceServerPath} to ${serverPath}`);

        // Sync core directories
        const dirsToSync = ['addons', 'dta', 'keys'];
        
        for (const dir of dirsToSync) {
            const sourcePath = path.join(sourceServerPath, dir);
            const destPath = path.join(serverPath, dir);
            
            if (await fs.pathExists(sourcePath)) {
                await fs.copy(sourcePath, destPath, { overwrite: true });
                console.log(`Synced ${dir} directory`);
            }
        }

        // Copy server executable
        const serverExe = 'DayZServer_x64.exe';
        const sourceExe = path.join(sourceServerPath, serverExe);
        const destExe = path.join(serverPath, serverExe);
        
        if (await fs.pathExists(sourceExe)) {
            await fs.copy(sourceExe, destExe, { overwrite: true });
            console.log(`Synced ${serverExe}`);
        }
    }

    /**
     * Download server files using SteamCMD
     */
    async downloadServerFiles(username, password) {
        return new Promise((resolve, reject) => {
            const steamCmdPath = path.join(this.settings.steamCmdPath, 'steamcmd.exe');
            const args = [
                '+force_install_dir', path.join(this.settings.steamCmdPath, 'steamapps', 'common', 'DayZServer'),
                '+login', username, password,
                '+app_update', '223350', 'validate',
                '+quit'
            ];

            console.log('Downloading DayZ server files...');
            const process = spawn(steamCmdPath, args);
            
            process.stdout.on('data', (data) => {
                console.log(data.toString());
            });

            process.stderr.on('data', (data) => {
                console.error(data.toString());
            });

            process.on('close', (code) => {
                if (code === 0) {
                    console.log('Server files downloaded successfully');
                    resolve();
                } else {
                    reject(new Error(`SteamCMD exited with code ${code}`));
                }
            });
        });
    }

    /**
     * Sync workshop mods to server mod directories
     */
    async syncMods(serverPath, mods) {
        for (const mod of mods) {
            const sourcePath = path.join(this.settings.workshopPath, mod.id);
            const destPath = path.join(serverPath, mod.folderName);
            
            if (await fs.pathExists(sourcePath)) {
                await fs.copy(sourcePath, destPath, { overwrite: true });
                console.log(`Synced mod ${mod.id} to ${mod.folderName}`);
                
                // Copy bikey files to server keys directory
                await this.copyBikeyFiles(destPath, path.join(serverPath, 'keys'));
            } else {
                console.warn(`Mod ${mod.id} not found in workshop directory`);
            }
        }
    }

    /**
     * Copy bikey files from mod directory to server keys directory
     */
    async copyBikeyFiles(modPath, keysPath) {
        try {
            await fs.ensureDir(keysPath);
            
            const files = await fs.readdir(modPath, { recursive: true });
            const bikeyFiles = files.filter(file => file.endsWith('.bikey'));
            
            for (const bikeyFile of bikeyFiles) {
                const sourcePath = path.join(modPath, bikeyFile);
                const destPath = path.join(keysPath, path.basename(bikeyFile));
                await fs.copy(sourcePath, destPath, { overwrite: true });
            }
            
            if (bikeyFiles.length > 0) {
                console.log(`Copied ${bikeyFiles.length} bikey files to keys directory`);
            }
        } catch (error) {
            console.error('Error copying bikey files:', error);
        }
    }

    /**
     * Clean old log files from server profile directory
     */
    async cleanLogFiles(profilePath) {
        const logPatterns = [
            'info*.log',
            'warning*.log', 
            'script*.log',
            'crash*.log',
            'error*.log',
            'RFFSHeli*.log',
            'serverconsole.log',
            'DayZServer*.ADM',
            'DayZServer*.rpt',
            'DayZServer*.mdmp',
            'ErrorMessage*.mdmp',
            'FROZEN*.mdmp',
            'LBmaster*.log'
        ];

        for (const pattern of logPatterns) {
            try {
                const files = await fs.readdir(profilePath);
                const matchingFiles = files.filter(file => this.matchesPattern(file, pattern));
                
                for (const file of matchingFiles) {
                    await fs.remove(path.join(profilePath, file));
                }
                
                if (matchingFiles.length > 0) {
                    console.log(`Cleaned ${matchingFiles.length} log files matching ${pattern}`);
                }
            } catch (error) {
                console.error(`Error cleaning log files with pattern ${pattern}:`, error);
            }
        }
    }

    matchesPattern(filename, pattern) {
        // Simple pattern matching for wildcards
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(filename);
    }
}

module.exports = ServerFileManager;
