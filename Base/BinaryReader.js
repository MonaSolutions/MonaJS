// https://www.html5rocks.com/en/tutorials/webgl/typed_arrays/

/**
 * BinaryReader allows to read binary data
 */
export class BinaryReader {

    constructor(data) {
        this._data = data.buffer instanceof ArrayBuffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
        this._size = this._data.byteLength;
        this._position = 0;
        this._view = new DataView(this._data.buffer, this._data.byteOffset, this._size);
    }

	data() { return this._data; }
	size() { return this._size; }

	available() { return this._size-this._position; }
	current() { return this._data[this._position]; }
	position() { return this._position; }
    reset(position=0) {  this._position  = position > this._size ? this._size : position; }

    shrink(available) {
        let rest = this._size-this._position;
        if (available > rest)
            return rest;
        this._size = this._position + available;
        return available;
    }
    
	next(count=1) {
        let rest = this._size-this._position;
        if(count > rest)
            count = rest;
		this._position += count;
        return count;
    }

    read8() {
        return this.next(1)==1 ? this._view.getUint8(this._position-1) : 0;
    }
    read16() {
		return this.next(2)==2 ? this._view.getUint16(this._position-2) : 0;
    }
    read24() {
		return this.next(3)==3 ? ((this._view.getUint16(this._position-3)<<8) | (this._view.getUint8(this._position-1)&0xFF)) : 0;
    }
	read32() {
		return this.next(4)==4 ? this._view.getUint32(this._position-4) : 0;
    }
    readDouble() {
		return this.next(8)==8 ? this._view.getFloat64(this._position-8) : 0;
    }
    read7Bit(bytes=5) {
        let byte;
        let result = 0;
        do {
            byte = this.read8();
            if(!--bytes)
                return ((result << 8) | byte) >>> 0; // Use all 8 bits from the 5th byte
            result = (result << 7) | (byte & 0x7F);
        } while (byte & 0x80);
        return result;
    }
    readString() { return String.fromCharCode(...read(this.read7Bit())); }
    
    readHex(size) {
        let hex = "";
        while(size--)
             hex += ('0' + this.read8().toString(16)).slice(-2);
        return hex;
    }

    /**
     * Read bytes, to convert bytes in string use String.fromCharCode(...reader.read(size))
     * @param {UInt32} size 
     */
    read(size) {
        if(this.available()<size)
            return new Uint8Array(size); // default value = empty bytearray!
        let value = this._data.subarray(this._position, this._position + size);
        this._position += size;
        return value;
    }
};
