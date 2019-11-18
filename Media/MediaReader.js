/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

//import { Media } from "./Media.js"

class StreamData {
    constructor() {
        this._pBuffer = null;
    }

	addStreamData(data, limit, ...args) {
		// Call onStreamData just one time to prefer recursivity rather "while repeat", and allow a "flush" info!
		let rest;
		if (this._pBuffer) {
			let newBuffer = new Uint8Array(this._pBuffer.byteLength + data.byteLength);
			newBuffer.set(this._pBuffer);
            newBuffer.set(new Uint8Array(data), this._pBuffer.byteLength);
            this._pBuffer = newBuffer;
			rest = Math.min(this.onStreamData(this._pBuffer, args), this._pBuffer.byteLength);
		} else {
			this._pBuffer = new Uint8Array(data);
			rest = Math.min(this.onStreamData(this._pBuffer, args), data.byteLength);
		}
		if (!rest) {
			// no rest, can have deleted this, so return immediatly!
			this._pBuffer = null;
			return true;
		}
		if (rest > limit) {
			// test limit on rest no before to allow a pBuffer in input of limit size + pBuffer stored = limit size too
			this._pBuffer = null;
			return false;
		}
		if (rest < this._pBuffer.byteLength)
			this._pBuffer = new Uint8Array(this._pBuffer.buffer, this._pBuffer.byteLength - rest, rest);
		return true;
	}
	clearStreamData(buffer) { 
		if (buffer)
			buffer = this._pBuffer;
		this._pBuffer = null; 
	}

    onStreamData(buffer, ...args) {}
};

export class MediaReader extends StreamData {
	
	//static MediaReader* New(const char* subMime);

    constructor() {
        super();
    }

	read(packet, source) { if(packet) this.addStreamData(packet, 0xFFFFFFFF, source); } // keep the check on packet (no sense for empty packet here!)
	flush(source) {
        //shared<Buffer> pBuffer;
		//Packet buffer(clearStreamData(pBuffer));
		let buffer;
        this.clearStreamData(buffer);
        this.onFlush(buffer, source);
    }

	//const char*			format() const;
	//MIME::Type			mime() const;
	//virtual const char*	subMime() const; // Keep virtual to allow to RTPReader to redefine it
//
	//~MediaReader() { flush(Media::Source::Null()); } // release data!

	onFlush(buffer, source) {
        source.reset();
	    source.flush(); // flush after reset!
    }
	/*!
	Implements this method, and return rest to wait more data.
	/!\ Must tolerate data lost, so on error displays a WARN and try to resolve the strem */
	parse(buffer, source) {}

	onStreamData(buffer, args) { return this.parse(buffer, args[0]); }
};

export class MediaTrackReader extends MediaReader {

    constructor(track) {
		super();
	    this.track = track;
        this.time = 0; // new container time
        this.compositionOffset = 0; // new container compositionOffset
    }

	flush(source) {
		super.flush(source);
		this.time = this.compositionOffset = 0;
	}

	onFlush(buffer, source) {} // no reset and flush for track, container will do it rather
};
