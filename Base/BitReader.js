// https://www.html5rocks.com/en/tutorials/webgl/typed_arrays/

export class BitReader {
	constructor(data) {
		this._data = new Uint8Array(data);
		this._size = this._data.byteLength;
		this._position = 0;
		this._bit=0;
	}
	
	data() { return this._data; }
	size() { return this._size; }
	available() { return (this._size -this._position)*8 - this._bit; }

	next(count=1) {
		let gotten = 0;
		while (this._position!=this._size && count--) {
			++gotten;
			if (++this._bit == 8) {
				this._bit = 0;
				++this._position;
			}
		}
		return gotten;
	}
	read(count=1) {
		let result = 0;
		while (this._position!=this._size && count--) {
			result <<= 1;
			if(this._data[this._position] & (0x80 >> this._bit++))
				result |= 1;
			if (this._bit == 8) {
				this._bit = 0;
				++this._position;
			}
		}
		return result;
	}
	read8() { return this.read(8); }
	read16() { return this.read(16); }
	read24() { return this.read(24); }
	read32() { return this.read(32); }
};
