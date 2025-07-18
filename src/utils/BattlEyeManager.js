const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class BattlEyeManager {
    constructor() {
        this.battleEyeFiles = [
            'BEClient_x64.dll',
            'BEClient.dll',
            'BEServer_x64.dll',
            'BEServer.dll',
            'BattlEye.exe'
        ];
        
        this.configFiles = [
            'BEServer_x64.cfg',
            'BEServer.cfg'
        ];
    }

    /**
     * Diagnose BattlEye setup for a server
     * @param {string} serverPath - Path to the server directory
     * @param {string} battleEyePath - Path to the BattlEye directory
     * @returns {Object} Diagnostic results
     */
    async diagnoseBattlEye(serverPath, battleEyePath) {
        const results = {
            status: 'ok',
            issues: [],
            warnings: [],
            suggestions: [],
            files: {
                missing: [],
                present: [],
                outdated: []
            },
            paths: {
                serverPath: serverPath,
                battleEyePath: battleEyePath,
                resolvedBEPath: null
            }
        };

        try {
            // Resolve BattlEye path
            const resolvedBEPath = path.resolve(serverPath, battleEyePath);
            results.paths.resolvedBEPath = resolvedBEPath;

            // Check if BattlEye directory exists
            if (!await fs.pathExists(resolvedBEPath)) {
                results.status = 'error';
                results.issues.push({
                    type: 'missing_directory',
                    message: `BattlEye directory does not exist: ${resolvedBEPath}`,
                    severity: 'critical',
                    fix: 'create_battleye_directory'
                });
                return results;
            }

            // Check for required BattlEye files
            for (const file of this.battleEyeFiles) {
                const filePath = path.join(resolvedBEPath, file);
                if (await fs.pathExists(filePath)) {
                    results.files.present.push(file);
                    
                    // Check file age (if older than 6 months, consider outdated)
                    const stats = await fs.stat(filePath);
                    const sixMonthsAgo = new Date();
                    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
                    
                    if (stats.mtime < sixMonthsAgo) {
                        results.files.outdated.push(file);
                        results.warnings.push({
                            type: 'outdated_file',
                            message: `${file} is older than 6 months (${stats.mtime.toDateString()})`,
                            severity: 'medium',
                            fix: 'update_battleye'
                        });
                    }
                } else {
                    results.files.missing.push(file);
                }
            }

            // Check for critical files
            const criticalFiles = ['BEServer_x64.dll', 'BEClient_x64.dll'];
            const missingCritical = criticalFiles.filter(file => results.files.missing.includes(file));
            
            if (missingCritical.length > 0) {
                results.status = 'error';
                results.issues.push({
                    type: 'missing_critical_files',
                    message: `Missing critical BattlEye files: ${missingCritical.join(', ')}`,
                    severity: 'critical',
                    fix: 'download_battleye'
                });
            }

            // Check BattlEye configuration
            const configPath = path.join(resolvedBEPath, 'BEServer_x64.cfg');
            if (!await fs.pathExists(configPath)) {
                results.warnings.push({
                    type: 'missing_config',
                    message: 'BEServer_x64.cfg not found - will be created automatically',
                    severity: 'low',
                    fix: 'create_config'
                });
            }

            // Check permissions
            try {
                await fs.access(resolvedBEPath, fs.constants.R_OK | fs.constants.W_OK);
            } catch (error) {
                results.issues.push({
                    type: 'permission_error',
                    message: `Insufficient permissions for BattlEye directory: ${error.message}`,
                    severity: 'high',
                    fix: 'fix_permissions'
                });
                results.status = 'error';
            }

            // Check for common path issues
            if (battleEyePath.includes(' ')) {
                results.warnings.push({
                    type: 'path_spaces',
                    message: 'BattlEye path contains spaces - this can cause issues',
                    severity: 'medium',
                    fix: 'quote_path'
                });
            }

            // Generate suggestions
            this.generateSuggestions(results);

        } catch (error) {
            results.status = 'error';
            results.issues.push({
                type: 'diagnostic_error',
                message: `Failed to diagnose BattlEye: ${error.message}`,
                severity: 'critical',
                fix: 'manual_check'
            });
        }

        return results;
    }

    /**
     * Generate suggestions based on diagnostic results
     * @param {Object} results - Diagnostic results
     */
    generateSuggestions(results) {
        if (results.files.missing.length > 0) {
            results.suggestions.push({
                title: 'Download Latest BattlEye Files',
                description: 'Download the latest BattlEye files from the official website',
                action: 'download_battleye',
                priority: 'high'
            });
        }

        if (results.files.outdated.length > 0) {
            results.suggestions.push({
                title: 'Update BattlEye Files',
                description: 'Your BattlEye files are outdated and should be updated',
                action: 'update_battleye',
                priority: 'medium'
            });
        }

        if (results.issues.some(issue => issue.type === 'missing_directory')) {
            results.suggestions.push({
                title: 'Create BattlEye Directory',
                description: 'Create the missing BattlEye directory structure',
                action: 'create_directory',
                priority: 'high'
            });
        }
    }

    /**
     * Setup BattlEye directory with default configuration
     * @param {string} battleEyePath - Path where to setup BattlEye
     * @returns {Object} Setup results
     */
    async setupBattlEye(battleEyePath) {
        const results = {
            success: false,
            message: '',
            actions: []
        };

        try {
            // Create BattlEye directory
            await fs.ensureDir(battleEyePath);
            results.actions.push(`Created directory: ${battleEyePath}`);

            // Create default BEServer_x64.cfg
            const configPath = path.join(battleEyePath, 'BEServer_x64.cfg');
            const defaultConfig = this.getDefaultBattlEyeConfig();
            await fs.writeFile(configPath, defaultConfig);
            results.actions.push(`Created config file: ${configPath}`);

            // Create scripts directory
            const scriptsPath = path.join(battleEyePath, 'scripts');
            await fs.ensureDir(scriptsPath);
            results.actions.push(`Created scripts directory: ${scriptsPath}`);

            // Create default script files
            await this.createDefaultScripts(scriptsPath);
            results.actions.push('Created default script files');

            results.success = true;
            results.message = 'BattlEye setup completed successfully';

        } catch (error) {
            results.success = false;
            results.message = `Failed to setup BattlEye: ${error.message}`;
        }

        return results;
    }

    /**
     * Get default BattlEye server configuration
     * @returns {string} Default configuration content
     */
    getDefaultBattlEyeConfig() {
        return `RConPassword changeme123
RConPort 2306
RestrictRCon 1
RConIP 127.0.0.1
MaxPing 0
`;
    }

    /**
     * Create default BattlEye script files
     * @param {string} scriptsPath - Path to scripts directory
     */
    async createDefaultScripts(scriptsPath) {
        const scripts = {
            'scripts.txt': '// BattlEye Scripts Configuration\n5 ""',
            'addbackpack.txt': '5 ""',
            'addmagazine.txt': '5 ""',
            'addweapon.txt': '5 ""',
            'attachto.txt': '5 ""',
            'createvehicle.txt': '5 ""',
            'deletevehicle.txt': '5 ""',
            'publicvariable.txt': '5 ""',
            'publicvariableval.txt': '5 ""',
            'remotecontrol.txt': '5 ""',
            'remoteexec.txt': '5 ""',
            'selectplayer.txt': '5 ""',
            'setdamage.txt': '5 ""',
            'setpos.txt': '5 ""',
            'setvariable.txt': '5 ""',
            'setvariableval.txt': '5 ""',
            'teamswitch.txt': '5 ""',
            'waypointcondition.txt': '5 ""',
            'waypointstatement.txt': '5 ""'
        };

        for (const [filename, content] of Object.entries(scripts)) {
            const filePath = path.join(scriptsPath, filename);
            await fs.writeFile(filePath, content);
        }
    }

    /**
     * Fix common BattlEye path issues in launch parameters
     * @param {string} launchParams - Original launch parameters
     * @param {string} serverPath - Server directory path
     * @returns {Object} Fixed parameters and suggestions
     */
    fixLaunchParameters(launchParams, serverPath) {
        const results = {
            original: launchParams,
            fixed: launchParams,
            changes: [],
            suggestions: []
        };

        // Fix BEpath parameter
        const bePathMatch = launchParams.match(/-BEpath=([^\s]+)/);
        if (bePathMatch) {
            const originalBEPath = bePathMatch[1];
            let fixedBEPath = originalBEPath;

            // Remove quotes if present
            fixedBEPath = fixedBEPath.replace(/['"]/g, '');

            // Ensure path is properly quoted if it contains spaces
            if (fixedBEPath.includes(' ') && !fixedBEPath.startsWith('"')) {
                fixedBEPath = `"${fixedBEPath}"`;
                results.changes.push('Added quotes around BEpath parameter');
            }

            // Replace in launch parameters
            results.fixed = results.fixed.replace(
                `-BEpath=${originalBEPath}`,
                `-BEpath=${fixedBEPath}`
            );
        } else {
            // Add BEpath parameter if missing
            const defaultBEPath = path.join(serverPath, 'battleye');
            results.fixed += ` -BEpath="${defaultBEPath}"`;
            results.changes.push('Added missing BEpath parameter');
        }

        // Check for other common issues
        if (!launchParams.includes('-profiles=')) {
            results.suggestions.push('Consider adding -profiles parameter for profile directory');
        }

        if (!launchParams.includes('-dologs')) {
            results.suggestions.push('Consider adding -dologs for detailed logging');
        }

        if (!launchParams.includes('-adminlog')) {
            results.suggestions.push('Consider adding -adminlog for admin logging');
        }

        return results;
    }

    /**
     * Download latest BattlEye files (placeholder - would need actual implementation)
     * @param {string} battleEyePath - Path to install BattlEye
     * @returns {Object} Download results
     */
    async downloadBattlEye(battleEyePath) {
        // This would need to be implemented with actual BattlEye download logic
        // For now, return a placeholder response
        return {
            success: false,
            message: 'Automatic BattlEye download not implemented. Please download manually from https://www.battleye.com/',
            downloadUrl: 'https://www.battleye.com/downloads/'
        };
    }

    /**
     * Get BattlEye troubleshooting steps
     * @returns {Array} Array of troubleshooting steps
     */
    getTroubleshootingSteps() {
        return [
            {
                step: 1,
                title: 'Verify BattlEye Directory',
                description: 'Ensure the BattlEye directory exists and contains the required files',
                action: 'Check if the battleye folder exists in your server directory'
            },
            {
                step: 2,
                title: 'Download Latest BattlEye',
                description: 'Download the latest BattlEye files from the official website',
                action: 'Visit https://www.battleye.com/downloads/ and download the server files'
            },
            {
                step: 3,
                title: 'Check File Permissions',
                description: 'Ensure the server has read/write access to the BattlEye directory',
                action: 'Right-click the battleye folder and check security permissions'
            },
            {
                step: 4,
                title: 'Verify Launch Parameters',
                description: 'Check that the -BEpath parameter points to the correct directory',
                action: 'Ensure -BEpath points to your server\'s battleye folder'
            },
            {
                step: 5,
                title: 'Check Antivirus',
                description: 'Ensure your antivirus is not blocking BattlEye files',
                action: 'Add the server directory to your antivirus exclusions'
            },
            {
                step: 6,
                title: 'Update Windows',
                description: 'Ensure Windows is up to date for proper BattlEye compatibility',
                action: 'Run Windows Update and install all available updates'
            }
        ];
    }
}

module.exports = BattlEyeManager;
