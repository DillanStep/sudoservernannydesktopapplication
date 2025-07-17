const dgram = require('dgram');
const { Buffer } = require('buffer');

class BattlEyeRCon {
    constructor(host, port, password) {
        this.host = host;
        this.port = port;
        this.password = password;
        this.socket = null;
        this.isLoggedIn = false;
        this.sequenceNumber = 0;
        this.keepAliveInterval = null;
        this.responseCallbacks = new Map();
        this.messageHandlers = [];
        
        this.PACKET_TYPES = {
            LOGIN: 0x00,
            COMMAND: 0x01,
            MESSAGE: 0x02
        };
    }

    // Calculate CRC32 checksum
    calculateCRC32(data) {
        const crcTable = this.generateCRC32Table();
        let crc = 0xFFFFFFFF;
        
        for (let i = 0; i < data.length; i++) {
            crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
        }
        
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    generateCRC32Table() {
        const table = new Array(256);
        
        for (let i = 0; i < 256; i++) {
            let crc = i;
            for (let j = 0; j < 8; j++) {
                if ((crc & 1) === 1) {
                    crc = (crc >>> 1) ^ 0xEDB88320;
                } else {
                    crc = crc >>> 1;
                }
            }
            table[i] = crc >>> 0;
        }
        
        return table;
    }

    // Create BattlEye packet with proper header
    createPacket(payload) {
        const payloadBuffer = Buffer.from(payload);
        const crc32 = this.calculateCRC32(payloadBuffer);
        
        const packet = Buffer.alloc(7 + payloadBuffer.length);
        
        // Header: 'B' 'E' CRC32 0xFF
        packet[0] = 0x42; // 'B'
        packet[1] = 0x45; // 'E'
        packet.writeUInt32LE(crc32, 2); // CRC32 (little-endian)
        packet[6] = 0xFF;
        
        // Copy payload
        payloadBuffer.copy(packet, 7);
        
        return packet;
    }

    // Parse incoming BattlEye packet
    parsePacket(data) {
        if (data.length < 7) {
            throw new Error('Invalid packet: too short');
        }
        
        // Verify header
        if (data[0] !== 0x42 || data[1] !== 0x45 || data[6] !== 0xFF) {
            throw new Error('Invalid packet: bad header');
        }
        
        // Extract and verify CRC32
        const receivedCRC = data.readUInt32LE(2);
        const payload = data.slice(7);
        const calculatedCRC = this.calculateCRC32(payload);
        
        if (receivedCRC !== calculatedCRC) {
            throw new Error('Invalid packet: CRC32 mismatch');
        }
        
        return payload;
    }

    // Connect and login to BattlEye RCon
    async connect() {
        return new Promise((resolve, reject) => {
            this.socket = dgram.createSocket('udp4');
            
            this.socket.on('message', (data, rinfo) => {
                try {
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error handling RCon message:', error);
                }
            });
            
            this.socket.on('error', (error) => {
                console.error('RCon socket error:', error);
                reject(error);
            });
            
            // Send login packet
            const loginPayload = Buffer.concat([
                Buffer.from([this.PACKET_TYPES.LOGIN]),
                Buffer.from(this.password, 'ascii')
            ]);
            
            const loginPacket = this.createPacket(loginPayload);
            
            this.socket.send(loginPacket, this.port, this.host, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                
                // Wait for login response
                const timeout = setTimeout(() => {
                    reject(new Error('Login timeout'));
                }, 5000);
                
                this.responseCallbacks.set('login', (success) => {
                    clearTimeout(timeout);
                    if (success) {
                        this.isLoggedIn = true;
                        this.startKeepAlive();
                        resolve();
                    } else {
                        reject(new Error('Login failed: incorrect password'));
                    }
                });
            });
        });
    }

    // Handle incoming messages
    handleMessage(data) {
        try {
            const payload = this.parsePacket(data);
            
            if (payload.length === 0) return;
            
            const packetType = payload[0];
            
            switch (packetType) {
                case this.PACKET_TYPES.LOGIN:
                    this.handleLoginResponse(payload);
                    break;
                    
                case this.PACKET_TYPES.COMMAND:
                    this.handleCommandResponse(payload);
                    break;
                    
                case this.PACKET_TYPES.MESSAGE:
                    this.handleServerMessage(payload);
                    break;
                    
                default:
                    console.warn('Unknown packet type:', packetType);
            }
        } catch (error) {
            console.error('Error parsing RCon packet:', error);
        }
    }

    // Handle login response
    handleLoginResponse(payload) {
        if (payload.length >= 2) {
            const success = payload[1] === 0x01;
            const callback = this.responseCallbacks.get('login');
            if (callback) {
                this.responseCallbacks.delete('login');
                callback(success);
            }
        }
    }

    // Handle command response
    handleCommandResponse(payload) {
        if (payload.length >= 2) {
            const sequenceNumber = payload[1];
            const response = payload.slice(2).toString('ascii');
            
            const callback = this.responseCallbacks.get(`command_${sequenceNumber}`);
            if (callback) {
                this.responseCallbacks.delete(`command_${sequenceNumber}`);
                callback(response);
            }
        }
    }

    // Handle server message
    handleServerMessage(payload) {
        if (payload.length >= 2) {
            const sequenceNumber = payload[1];
            const message = payload.slice(2).toString('ascii');
            
            // Send acknowledgment
            const ackPayload = Buffer.from([this.PACKET_TYPES.MESSAGE, sequenceNumber]);
            const ackPacket = this.createPacket(ackPayload);
            this.socket.send(ackPacket, this.port, this.host);
            
            // Notify message handlers
            this.messageHandlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    console.error('Error in message handler:', error);
                }
            });
        }
    }

    // Send command to server
    async sendCommand(command) {
        if (!this.isLoggedIn) {
            throw new Error('Not logged in to RCon');
        }
        
        return new Promise((resolve, reject) => {
            const currentSeq = this.sequenceNumber;
            this.sequenceNumber = (this.sequenceNumber + 1) % 256;
            
            const commandPayload = Buffer.concat([
                Buffer.from([this.PACKET_TYPES.COMMAND, currentSeq]),
                Buffer.from(command, 'ascii')
            ]);
            
            const commandPacket = this.createPacket(commandPayload);
            
            this.socket.send(commandPacket, this.port, this.host, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                
                // Wait for response
                const timeout = setTimeout(() => {
                    this.responseCallbacks.delete(`command_${currentSeq}`);
                    reject(new Error('Command timeout'));
                }, 10000);
                
                this.responseCallbacks.set(`command_${currentSeq}`, (response) => {
                    clearTimeout(timeout);
                    resolve(response);
                });
            });
        });
    }

    // Start keep-alive mechanism
    startKeepAlive() {
        this.keepAliveInterval = setInterval(() => {
            if (this.isLoggedIn) {
                // Send empty command packet to keep connection alive
                const keepAlivePayload = Buffer.from([this.PACKET_TYPES.COMMAND, this.sequenceNumber]);
                this.sequenceNumber = (this.sequenceNumber + 1) % 256;
                
                const keepAlivePacket = this.createPacket(keepAlivePayload);
                this.socket.send(keepAlivePacket, this.port, this.host);
            }
        }, 40000); // Send every 40 seconds (less than 45 second timeout)
    }

    // Add message handler
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    // Remove message handler
    removeMessageHandler(handler) {
        const index = this.messageHandlers.indexOf(handler);
        if (index > -1) {
            this.messageHandlers.splice(index, 1);
        }
    }

    // Disconnect from RCon
    disconnect() {
        this.isLoggedIn = false;
        
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        
        this.responseCallbacks.clear();
        this.messageHandlers = [];
    }

    // DayZ-specific commands
    async restartServer(message = 'Server restart', timeMinutes = 0) {
        if (timeMinutes > 0) {
            return await this.sendCommand(`#restart ${timeMinutes} ${message}`);
        } else {
            return await this.sendCommand('#restart');
        }
    }

    async shutdown(message = 'Server shutdown') {
        return await this.sendCommand(`#shutdown ${message}`);
    }

    async getPlayers() {
        return await this.sendCommand('players');
    }

    async kickPlayer(playerId, reason = 'Kicked by admin') {
        return await this.sendCommand(`kick ${playerId} ${reason}`);
    }

    async banPlayer(playerId, reason = 'Banned by admin') {
        return await this.sendCommand(`ban ${playerId} ${reason}`);
    }

    async say(message) {
        return await this.sendCommand(`say -1 ${message}`);
    }

    async sayToPlayer(playerId, message) {
        return await this.sendCommand(`say ${playerId} ${message}`);
    }

    async loadBans() {
        return await this.sendCommand('loadBans');
    }

    async loadScripts() {
        return await this.sendCommand('loadScripts');
    }

    async loadEvents() {
        return await this.sendCommand('loadEvents');
    }
}

module.exports = BattlEyeRCon;
