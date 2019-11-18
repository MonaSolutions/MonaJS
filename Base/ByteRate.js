import { Util } from "./Util.js";

export class ByteRate extends Number {
	constructor(detla=1) {
		super(0);
		this._time = Util.Time();
		this._value = 0;
		this._delta = detla*1000;
		this._bytes=0;
	}

	value() { return Math.round(this.exact()); }
	exact() {
		let now = Util.Time();
		let elapsed = now - this._time;
		if (elapsed > this._delta) { // wait "_delta" before next compute rate
			this._value = this._bytes * 1000.0 / elapsed;
			this._bytes = 0;
			this._time = now;
		}
		return this._value;
	}

	addBytes(bytes) {
		this._bytes += bytes;
		return this;
	}
};
