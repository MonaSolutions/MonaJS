/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

import Array from "./Array.js";
import Util from "./Util.js";
import BinaryReader from "./BinaryReader.js";
import BinaryWriter from "./BinaryWriter.js";

class Packets extends Array {
    static get ID_MIN() { return 1; }
    static get ID_MAX() { return 0xFFFFFF; }
    
    static Distance(id1, id2) { return Util.Distance(id1, id2, Packets.ID_MAX, Packets.ID_MIN); }
    static AddDistance(id, distance) { return Util.AddDistance(id, distance, Packets.ID_MAX, Packets.ID_MIN); }

    constructor() {
        super();
        this.comparator = (a, b) => Packets.Distance(b.id, a.id);
    }
}

/**
 * Quick Reliable Transfer
 * see https://docs.google.com/document/d/1WdPFZyJ_FoekFGcGuiXMoANoWOsgR2hGTJuCku9B2zE/edit#heading=h.gwc8rqabrwtu
 * TODO onSend(packet) {} // if packet null => sending buffer exceed => irrecuperable error
 * TODO onRecv(packet) {} // if packet null => receiving buffer exceed => irrecuperable error
 */
export class QRT {
    onSend(packet) {} // if packet null => sending error irrecuperable!
    onRecv(packet) {} // if packet null => receiving error irrecuperable!
    onFlush() {}

    static get HEADER_SIZE() { return 3; }

    get queueing() { return this._queueings.length; }

    constructor() {
        this._topAckId = 1;
        this._sendings = new Packets();
        this._sendings.holes = 0;
        this._queueings = new Packets();
        this._sendId = 1;
        this._receivings = new Packets();
        this._recvId = 1;
        this._lastSend = Util.Time();
        this._canSend = -1;
    }

    recv(packet) {
        let reader = new BinaryReader(packet);
        packet.id = reader.read24();
        if(!packet.id) {
            // ACK
            let ackId = reader.read24();
            let index = Array.LowerBound(this._sendings, {id:ackId});
            packet = this._sendings[index];
            if(!packet || packet.id!=ackId) 
                return; // ack already gotten (duplicated ack!)
            this._sendings.splice(index, 1);
            // two packets to increase sending window if ack is to the top is without any hole before
            
            this._canSend += (this._canSend<0 ? 2 : 1);
            if(Packets.Distance(this._topAckId, ackId)>0) {
                this._topAckId = ackId;
                if(!index--) {
                    if(!this._sendings.length)
                        ++this._canSend;
                } else for(let i = 0; i<index; ++i) {
                    let packet = this._sendings[i];
                    if(Packets.Distance(packet.repeatId, ackId)>0 && !this._send(packet))
                        return;
                }
            }
            // Continue sending flow with canSend packet!
            while(this._queueings.length && this._canSend) {
                this._send(this._queueings.shift());
                if(!this._queueings.length)
                    this.onFlush();
            }
            return;
        }
        // SEND ACK
        let writer = new BinaryWriter();
        writer.write24(0).write24(packet.id);
        this.onSend(writer.data());
        // RECV
        let distance = Packets.Distance(this._recvId, packet.id);
        if(distance<0) {
            console.warn("PACKET REPEATED "+packet.id);
            return; // packet repeated!
        }
        if(distance) // memorize the packet (wait order reparation)
            return Array.Insert(this._receivings, packet);
        this.onRecv(packet.subarray(3));
        // flush ordered reception!
        let index = 0;
        while(index<this._receivings.length && Packets.Distance(packet.id, this._receivings[index].id)==1)
            this.onRecv((packet = this._receivings[index++]).subarray(3));
        this._recvId = Packets.AddDistance(packet.id, 1);
        this._receivings.splice(0, index);
    }

    manage() {
        // console.log(this._queueings.length, this._sendings.length);
        if((Util.Time()-this._lastSend)<(this._canSend<0 ? Util.RTO_INIT : Util.RTO_MIN))
            return; // let do current acking!
        // block current sending (_canSend=0) and repeat 6 packets (8192 bytes)!
        let packets = this._sendings.length ? this._sendings : this._queueings;
        this._canSend = Math.min(6, packets.length);
        for(let i=0; i<this._canSend; ++i)
            this._send(packets[i]);
    }

    send(packet) {
        if(this._queueings.length || !this._send(packet))
            this._queueings.push(packet); // add to packets queueings (wait ACK)
        return true;
    }

    _send(packet) {
        if(!this._canSend) {
            if(this._queueings.length || this._sendings.length)
                return false;
            this._canSend = -1; // reset sending ability for a new sending cycle
        }
        if(!packet.id) {
            let writer = new BinaryWriter();
            writer.write24(this._sendId);
            writer.write(packet);
            packet = writer.data();
            packet.id = this._sendId;
            this._sendId = Packets.AddDistance(this._sendId, 1);
            this._sendings.push(packet);
        } else
            console.log("repeat ", packet.id);
        packet.repeatId = this._sendings[this._sendings.length-1].id;
        this._lastSend = Util.Time();
        this.onSend(packet);
        if(this._canSend>0)
            --this._canSend;
        return true;
    }

};
