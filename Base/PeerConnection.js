import { SDP } from "./SDP.js";
import { Util } from "./Util.js";
import { ByteRate } from "./ByteRate.js";

/**
 * Negotiation of Peer connection (offer/answer)
 * Example:
 *      localNegotiation.setOffer()
 *      .then((sdp) => {
 *          remoteNegotiation.setOffer(sdp)
 *          .then((sdp) => {
 *              remoteNegotiation.setAnswer()
 *              .then((sdp) => localNegotiation.setAnswer(sdp))
 *              .catch((error) => { throw new Error(error); });
 *          })
 *          .catch((error) => { throw new Error(error); });
 *      })
 *      .catch((error) => { throw new Error(error); });
 */
export class PeerConnection {
    onOpen() {}
    onData(message) {}
    onClose(error=null) { if(error) console.error(error); }
    onFlush() {}

    /**
     * - null, nothing done
     * - SDP.TYPE_OFFER, offer done
     * - SDP.TYPE_ANSWER, answer done
     * - "connected"
     * - "closed"
     */
    get state() { return this._state; }
    get recvTime() { return this._recvTime; }
    get recvByteRate() { return this._recvByteRate.value(); }
    get sendTime() { return this._sendTime; }
    get sendByteRate() { return this._sendByteRate.value(); }
    get negotiating() { return this._negotiate ? true : false; }
    get params() { return this._params; }
    get queueing() {
        if(!this._channel || !this._channel.bufferedAmount)
            return 0;
        return Math.max(this._channel.bufferedAmount - (Math.round(this._sendByteRate.exact()/10) || 15999999), 0); // tolerate 100ms of sending (or something<16MBytes if send is starting)
    }

    constructor(params={stunServers:[], timeout:14, maxRetransmits:null, ordered:true}) { // timeout must be superior to HTTP RDV timeout and ICE connection timeout (the both are around 10 sec)
        if(params.ordered===undefined)
            params.ordered = true;
        this._params = params;
        this._options = {maxRetransmits: params.maxRetransmits, ordered: params.ordered};
        this._recvTime = Util.Time(); // Now because connection has operated few receiving
        this._recvByteRate = new ByteRate();
        this._sendTime = Util.Time(); // Now because connection has operated few sending
        this._sendByteRate = new ByteRate();
        this._timeout = (params.timeout || 14)*1000;
        this._state = null;
        this._sdp = null;
        this._remoteSdp = null;
        this._negotiate = null;
        this._negotiation = 0;
        this._channel = null;
        let stunUrls = [];
        if(params.stunServers) {
            for (let stunUrl of params.stunServers)
                stunUrls.push("stun:" + stunUrl);
        }
        //console.log("STUN server list : ", stunUrls);
        this._connection = new RTCPeerConnection(stunUrls.length ? {iceServers: [{ urls: stunUrls}]} : null);
        this._connection.ondatachannel = (e) =>  {
            this._channel = e.channel;
            this._channel.binaryType = "arraybuffer";
            this._channel.onbufferedamountlow = () => this.onFlush();
            this._channel.onmessage = (e) => {
                this._recvTime = Util.Time();
                this._recvByteRate.addBytes(e.data.byteLength);
                this.onData(e.data);
            }
            this._channel.onerror = (e) => console.error("channel error", (e.message || e.toString()));
            this._channel.onopen = (e) => {
                this._channel.onopen = null; // to avoid double call to onopen!
                this._state = "connected";
                this._connection.oniceconnectionstatechange(null); // stop timeout! (onopen can happen before end of negotiation!)
               this.onOpen();
            };
        }
        this._connection.oniceconnectionstatechange = (e) => {
            //console.log("iceConnectionState="+this._connection.iceConnectionState+" ; connectionState="+this._connection.connectionState);
            if(this._timeoutID)
                clearTimeout(this._timeoutID); // iceconnectionstate has changed => reset timeout!

            switch (this._connection.iceConnectionState) {
                case "closed":
                    return this.close();
                // /!\ With Chrome Canary 73 we receive state "failed" but the connection succeed (TODO: remove this when resolved)
                case "failed":
                    if (this._connection.connectionState != "connecting")
                        return this.close(this._connection.iceConnectionState);
                case "completed":
                case "connected":
                    this._timeoutID = null;
                    return; // stop timeout!
                default: // reset timeout!
            };
            if(this._timeout)
                this._timeoutID = setTimeout(() => this.close(this._channel ? this._connection.iceConnectionState : 408), this._timeout);
            return;
        };
        if(this._timeout)
            this._timeoutID = setTimeout(() => this.close(408), this._timeout);
    }

    send(packet) {
        try {
            this._channel.send(packet);
            this._sendTime = Util.Time();
            this._sendByteRate.addBytes(packet.byteLength);
        } catch(e) {
            // call "this.connection" rather "this" because when Peer is GroupConnection it could close the entiere GroupConnection!
            setTimeout(() => this.close(e.message || e.toString()), 0); // async to support foreach + send on peers collection
            return false;
        }
        return true;
    }

    /**
     * Release the negotiation, call it allow to abort a possible current negotiation
    */
    close(error=null) {
        if(this._timeoutID)
            clearTimeout(this._timeoutID);
        if(!this._connection)
            return;
        this._connection.ondatachannel = this._connection.oniceconnectionstatechange = null;
        if(this._channel) {
            this._channel.onopen = null;
            this._channel.onmessage = null; // otherwise even after _channel.close() you can receive always messages!
            this._channel.close();
        }
        this._connection.close();
        this._connection = null;
        if(this._negotiate)
            this._onFail(error); // liberate Promize
        this.onClose(error);
        this._state = "closed"; // in last to be able to read old state in onClose!
    }

    /**
     * Set offer,
     *  - if sdp is null it creates a local offer and sets it as local description
     *  - if sdp is binary it sets it as remote description
     * Promise.resolve(sdp) returns offer on success
     * Promise.rejected(error) on error
     * @param {object} sdp
     */
    setOffer(sdp) { return this.setSDP(SDP.TYPE_OFFER, sdp); }

    /**
     * Set answer,
     *  - if sdp is null it creates a local answer and sets it as local description
     *  - if sdp is binary it sets it as remote description
     * Promise.resolve(sdp) returns offer on success
     * Promise.rejected(error) on error
     * @param {binary or null or string} sdp 
     */
    setAnswer(sdp) { return this.setSDP(SDP.TYPE_ANSWER, sdp); }

    setSDP(type, sdp) { return new Promise((onSuccess, onFail) => {
        if(!this._connection)
            return onFail("Connection closed");
        if(this._negotiate)
            return onFail("Wait end of " + this._negotiate.type + " negotiation call before to try to " + type);
        if(sdp)
            sdp = SDP.FromString(sdp);

        // keep _negotiate assignation before first setSDP onSuccess to allow to reset timer if onSuccess (RDV has need of that to retry a setSDP on timeout!)
        this._negotiate = { type: type, onSuccess: onSuccess, onFail: onFail};

        if(this._remoteSdp && sdp && this._remoteSdp.negotiation && (!sdp.negotiation || Util.Distance32(this._sdp.negotiation, sdp.negotiation)<=0))
            return this._onFail(this._negotiate.type + " obsolete");

        if(sdp) {
            if(this._sdp && this._sdp.group) {
                // is answer, do matching group+mid (m lines are ordered)
                sdp.group = this._sdp.group;
                let i = 0;
                for(let media of this._sdp) {
                    if(i>=sdp.length)
                        break;
                    sdp[i++].mid = media.mid;
                }
            }
            this._connection.setRemoteDescription({ type: type, sdp: SDP.ToString(sdp) })
            .then(()=> {
                this._remoteSdp = sdp;
                this._onSuccess(sdp)
            })
            .catch((e) => this._onFail(e.message || e.toString()));
            return;
        } 

        if(!this._channel && type==SDP.TYPE_OFFER)
            this._connection.ondatachannel({channel: this._connection.createDataChannel("data", this._options)});

        let candidates = new Array();
        this._connection.onicecandidate = (e) => {
            //console.log(Date.now(), "ice " + (e.candidate ? e.candidate.candidate : "null"));
            if(!e.candidate) {
                if(!sdp)
                    return true; // can maybe happen if setLocalDescription has failed
                if(!candidates.length) {
                    this._onFail("no candidates");
                    return true;
                }
                for(let candidate of candidates) {
                    let media = sdp[candidate.sdpMLineIndex];
                    if(!media) {
                         this._onFail("No " + candidate.sdpMLineIndex + " media in SDP to add candidate");
                         return true;
                    }
                    SDP.AddAttribute(media, candidate.candidate);
                }
                this._onSuccess(sdp);
            } else
                candidates.push(e.candidate); // sdp can possibly not exists always (wait end of onicecandidate)
            return true;
        }
        this._connection[type==SDP.TYPE_OFFER ? "createOffer" : "createAnswer"].call(this._connection, {iceRestart:true}) // ice restart because has been an explicit new setSDP call!
        .then((description) => {
            this._connection.setLocalDescription(description)
            .then(() => {
                this._sdp = sdp = SDP.FromString(description.sdp);
                sdp.negotiation = ++this._negotiation;
            })
            .catch((e) => this._onFail(e.message || e.toString()));
        })
        .catch((e) => this._onFail(e.message || e.toString()));
    })}

    _onSuccess(sdp) {
        if(!this._negotiate)
            return;
        if(this._state != "connected") {
             // on success reset timer!
            if( this._timeoutID) {
                clearTimeout(this._timeoutID);
                this._timeoutID = setTimeout(() => this.close(408), this._timeout);
            }
            this._state = this._negotiate.type;
        }
        let onSuccess =  this._negotiate.onSuccess;
        this._negotiate = null;
        onSuccess(sdp);
    }

    _onFail(error) {
        if(!this._negotiate)
            return;
        let onFail =  this._negotiate.onFail;
        this._negotiate = null;
        onFail(error || 499); // if no error it's a call to _onFail on close PeerConnecton to liberate current negotiate => 499:client close!
    }

};
