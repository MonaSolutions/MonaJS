/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

import { ByteRate } from "./ByteRate.js";
import { Util } from "./Util.js";

export class ServerConnection {
    onOpen() {}
    onData(message) {}
    onClose(error=null) { if(error) console.error(error); } // 408 = timeout, 410 = Gone, server is closed!
 
    /**
     * - null, nothing done
     * - SDP.TYPE_OFFER, offer done
     * - SDP.TYPE_ANSWER, answer done
     * - "connected"
     * - "closed"
     */
    get state() {
        if(this._socket) {
            switch(this._socket.readyState) {
                case 0: // connecting
                    return null;
                case 1: // open
                    return "connected"
                default:;
            }
        }
        return "closed";
    }
    get recvTime() { return this._recvTime; }
    get recvByteRate() { return this._recvByteRate.value(); }
    get sendTime() { return this._sendTime; }
    get sendByteRate() { return this._sendByteRate.value(); }
    get negotiating() { return !this._socket || this._socket.readyState ? false : true; }
    get queueing() {
        if(!this._socket || !this._socket.bufferedAmount)
            return 0;
        return Math.max(this._socket.bufferedAmount - (Math.round(this._sendByteRate.exact()/10) || 15999999), 0); // tolerate 100ms of sending (or something<16MBytes if send is starting)
    }
    get url() { return this._socket && this._socket.url; }

    constructor(url, timeout=0) {
        this._recvTime = Util.Time(); // Now because connection has operated few receiving
        this._recvByteRate = new ByteRate();
        this._sendTime = Util.Time(); // Now because connection has operated few sending
        this._sendByteRate = new ByteRate();
        this._timeout = timeout*1000;
        this._socket = new WebSocket(url);
        this._socket.binaryType = "arraybuffer";
        this._socket.onopen = (e) => {
            if(this._timeoutID)
                clearTimeout(this._timeoutID);
            this.onOpen();
        }
        // no error event because in WebSocket it contains no error description, use onclose + e.code|reason rather!
        this._socket.onclose = (e) => {
            switch(e.code) {
                case 1000:
                    return this.close(); // normal close
                case 1001:
                    return this.close(410); // server gone!
                default:
                    this.close(e.reason || e.code);
            }
        }
        this._socket.onmessage = (e) => {
            this._recvTime = Util.Time();
            this._recvByteRate.addBytes(e.data.byteLength);
            this.onData(e.data);
        }
        if(this._timeout)
            this._timeoutID = setTimeout(() => this.close(408), this._timeout);
    }

    send(packet) {
        try {
            this._socket.send(packet);
            this._sendTime = Util.Time();
            this._sendByteRate.addBytes(packet.byteLength);
        } catch(e) {
            // call "this.connection" rather "this" because when Peer is GroupConnection it could close the entiere GroupConnection!
            setTimeout(() => this.close(e.message || e.toString()), 0); // async to support foreach + send on peers collection
            return false;
        }
        return true;
    }

    close(error=null) {
        if(this._timeoutID)
            clearTimeout(this._timeoutID);
        if(!this._socket)
            return;
        let socket = this._socket;
        socket.onopen = null;
        socket.onmessage = null;  // otherwise even after socket.close() you can receive always messages!
        this._socket = null;
        this.onClose(error);
        socket.close(); // keep after onClose because can call pulseServerConnection in GroupConnection!
    }

};
