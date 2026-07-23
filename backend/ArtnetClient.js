const dgram = require('dgram');

class ArtnetClient {
    constructor() {
        this.socket = null;
        this.universes = new Map(); // Map<universe, {data, lastSeen, sourceIp}>
        this.nodes = new Map(); // Map<ip, {shortName, longName, lastSeen}>
        
        this.onUniverseUpdate = null; // (universe, data, sourceIp) => void
        this.onNodeUpdate = null; // (ip, info) => void
        this.onError = null; // (errMessage) => void
        
        // Protocol constants
        this.ARTNET_PORT = 6454;
        this.MAGIC_HEADER = Buffer.from('Art-Net\0');
        this.OP_DMX = 0x5000;
        this.OP_POLL = 0x2000;
        this.OP_POLLREPLY = 0x2100;
    }

    start(bindIp = '0.0.0.0') {
        if (this.socket) {
            return;
        }

        try {
            // Create UDP socket with reuseAddr enabled
            this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            this.socket.on('error', (err) => {
                console.error(`ArtnetClient socket error:\n${err.stack}`);
                if (this.onError) {
                    this.onError(err.message);
                }
                this.stop();
            });

            this.socket.on('message', (msg, rinfo) => {
                this._handlePacket(msg, rinfo);
            });

            this.socket.on('listening', () => {
                const address = this.socket.address();
                console.log(`ArtnetClient listening on ${address.address}:${address.port}`);
                try {
                    this.socket.setBroadcast(true);
                } catch (e) {
                    console.warn('Could not set broadcast on Artnet socket:', e);
                }
            });

            this.socket.bind(this.ARTNET_PORT, bindIp);
        } catch (err) {
            console.error('Failed to start ArtnetClient:', err);
            if (this.onError) {
                this.onError(err.message);
            }
            this.socket = null;
        }
    }

    stop() {
        if (this.socket) {
            try {
                this.socket.close();
            } catch (e) {
                console.error('Error closing socket:', e);
            }
            this.socket = null;
        }
        this.universes.clear();
        this.nodes.clear();
        console.log('ArtnetClient stopped and buffers cleared.');
    }

    poll() {
        if (!this.socket) return;
        
        // Construct a minimal ArtPoll packet
        // Header (8), OpCode (2), ProtVerHigh (1), ProtVerLow (1)
        // TalkToMe (1), Priority (1)
        const packet = Buffer.alloc(14);
        this.MAGIC_HEADER.copy(packet, 0); // "Art-Net\0"
        packet.writeUInt16LE(this.OP_POLL, 8); // OpPoll = 0x2000
        packet.writeUInt8(0, 10); // ProtVer = 14
        packet.writeUInt8(14, 11);
        packet.writeUInt8(0x02, 12); // TalkToMe: Send replies on change and poll
        packet.writeUInt8(0, 13); // Priority: lowest

        try {
            // Broadcast to 255.255.255.255
            this.socket.send(packet, 0, packet.length, this.ARTNET_PORT, '255.255.255.255');
        } catch (e) {
            console.error('Failed to send ArtPoll:', e);
        }
    }

    getActiveUniverses() {
        const result = [];
        for (const [universe, data] of this.universes.entries()) {
            result.push({
                universe,
                sourceIp: data.sourceIp,
                lastSeen: data.lastSeen
            });
        }
        return result;
    }
    
    getUniverseSnapshot(universe) {
        return this.universes.get(universe) || null;
    }

    _handlePacket(msg, rinfo) {
        // Minimum valid Art-Net header size is 10 (Magic + OpCode)
        if (msg.length < 10) return;

        // Validate "Art-Net\0" magic header
        for (let i = 0; i < 8; i++) {
            if (msg[i] !== this.MAGIC_HEADER[i]) return;
        }

        // OpCode is little-endian UInt16 at offset 8
        const opCode = msg.readUInt16LE(8);

        if (opCode === this.OP_DMX) {
            this._handleDmx(msg, rinfo);
        } else if (opCode === this.OP_POLLREPLY) {
            this._handlePollReply(msg, rinfo);
        }
    }

    _handleDmx(msg, rinfo) {
        // OpDmx minimum length: Header(8) + OpCode(2) + ProtVer(2) + Sequence(1) + Physical(1) + SubUni(1) + Net(1) + Length(2) = 18 bytes
        if (msg.length < 18) return;

        // ProtVer is at 10-11, Sequence at 12, Physical at 13.
        const subUni = msg.readUInt8(14);
        const net = msg.readUInt8(15);
        const universe = (net << 8) | subUni; // 15-bit universe address

        // Length is big-endian
        const length = msg.readUInt16BE(16);
        
        // Bounds-check declared length
        if (length < 2 || length > 512 || msg.length < 18 + length) {
            return; // Invalid or truncated packet
        }

        // Read channel data (extract exact length)
        // Note: DMX data must be an even length natively (2-512)
        const channelData = new Uint8Array(msg.buffer, msg.byteOffset + 18, length);
        
        // We create a fast copy to send via IPC
        const dataCopy = Array.from(channelData);

        this.universes.set(universe, {
            data: dataCopy,
            lastSeen: Date.now(),
            sourceIp: rinfo.address
        });

        if (this.onUniverseUpdate) {
            this.onUniverseUpdate(universe, dataCopy, rinfo.address);
        }
    }

    _handlePollReply(msg, rinfo) {
        // Minimum length for a PollReply to extract short/long name is around 207 bytes
        // (Header 8, Op 2, IP 4, Port 2, Vers 2, NetSwitch 1, SubSwitch 1, Oem 2, Ubea 1, Status 1, Esta 2, ShortName 18, LongName 64, ...)
        if (msg.length < 108) return; 

        try {
            // ShortName is 18 bytes starting at offset 26
            const shortNameBuf = msg.subarray(26, 44);
            // LongName is 64 bytes starting at offset 44
            const longNameBuf = msg.subarray(44, 108);

            const shortName = this._parseNullTerminatedString(shortNameBuf);
            const longName = this._parseNullTerminatedString(longNameBuf);

            const info = {
                shortName,
                longName,
                lastSeen: Date.now()
            };

            this.nodes.set(rinfo.address, info);

            if (this.onNodeUpdate) {
                this.onNodeUpdate(rinfo.address, info);
            }
        } catch (e) {
            console.error('Error parsing ArtPollReply:', e);
        }
    }

    _parseNullTerminatedString(buffer) {
        let end = 0;
        while (end < buffer.length && buffer[end] !== 0) {
            end++;
        }
        return buffer.toString('utf8', 0, end);
    }
}

module.exports = ArtnetClient;
