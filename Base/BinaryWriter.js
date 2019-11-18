/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

// https://www.html5rocks.com/en/tutorials/webgl/typed_arrays/

/**
 * BinaryWriter allows to write data in its binary form
 */
export class BinaryWriter {
	constructor(dataOrSize=128, offset=0, length=0) {
		if(dataOrSize instanceof ArrayBuffer) {
			// overrides data
			this._data = new Uint8Array(dataOrSize, offset, length);
			this._size = 0;
		} else if(dataOrSize.buffer instanceof ArrayBuffer)  {
			// append to existing data!
			this._data = new Uint8Array(dataOrSize.buffer, dataOrSize.byteOffset, dataOrSize.byteLength);
			this._size = dataOrSize.byteLength;
		} else {
			// allocate new buffer
			this._data = new Uint8Array(dataOrSize);
			this._size = 0;
		}
		this._view = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
	}
	 
	data() { return new Uint8Array(this._data.buffer, this._data.byteOffset, this._size); }
	size() { return this._size; }

	next(count=1) { return this.reserve(this._size+=count); }
	clear(size = 0) { return this.reserve(this._size=size); }
	
	write(data) {
		this.reserve(this._size + data.length);
		if(typeof(data) == "string") {
			for (let i=0; i<data.length; ++i)
				this._data[this._size++] = data.charCodeAt(i);
			return this;
		}
		this._data.set(data, this._size);
		this._size += data.length;
		return this;
	}

	write8(value) {
		this.reserve(this._size+1);
		this._data[this._size++] = value;
		return this;
	}
	write16(value) {
		this.reserve(this._size+2);
		this._view.setUint16(this._size, value);
		this._size += 2;
		return this;
	}
	write24(value) {
		this.reserve(this._size+3);
		this._view.setUint16(this._size, value>>8);
		this._view.setUint8(this._size+=2, value&0xFF);
		++this._size;
		return this;
	}
	write32(value) {
		this.reserve(this._size+4);
		this._view.setUint32(this._size, value);
		this._size += 4;
		return this;
	}
	writeDouble(value) {
		this.reserve(this._size+8);
		this._view.setFloat64(this._size, value);
		this._size += 8;
		return this;
	}
	write7Bit(value, bytes=5) {
		if(!bytes)
			return this;
		let bits = (bytes - 1) * 7 + 1;
		if (!(value >> (bits - 1))) {
			bits -= 8;
			while (!(value >> bits) && (bits -= 7));
		}
		while (bits>1) {
			this.write8(0x80 | ((value >> bits) & 0xFF));
			bits -= 7;
		}
		return this.write8(value & (bits ? 0xFF : 0x7F));
	}
	writeString(value) { return this.write7Bit(value.length).write(value); }

	writeHex(value) {
		for (let i = 0; i < value.length; i += 2)
			this.write8(parseInt(value.substring(i, i+2), 16));
		return this;
	}

	reserve(size) {
		if(this._data && size<= this._data.byteLength)
			return this;

		if(this._view.byteOffset)
			throw new Error("writing exceeds maximum ",this._data.byteLength," bytes limit");

		--size;
		size |= size >> 1;
		size |= size >> 2;
		size |= size >> 4;
		size |= size >> 8;
		size |= size >> 16;
		++size;

		let data = new Uint8Array(size);
		data.set(this._data); // copy old buffer!
		this._view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		this._data = data;
		return this;
	}

};