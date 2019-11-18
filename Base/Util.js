/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

let _perf = performance;

export let Util = {

	RTO_MIN: 1000, // see https://tools.ietf.org/html/rfc2988
	RTO_INIT: 3000,
	RTO_MAX: 10000,
	NET_RELIABLE_SIZE: 1200,
	SCTP_HEADER_SIZE: 28,
	UINT8_GENERATORS: [0, 1, 1, 2, 1, 3, 5, 4, 5, 7, 7, 7, 7, 8, 9, 8, 11, 11, 11, 12, 11, 13, 15, 14, 17, 14, 15, 17, 17, 18, 19, 19, 21, 20, 21, 22, 23, 23, 23, 23, 27, 25, 25, 27, 27, 28, 27, 29, 31, 30, 31, 32, 31, 33, 31, 34, 37, 35, 37, 36, 37, 38, 37, 40, 41, 41, 41, 41, 41, 43, 43, 44, 43, 45, 47, 46, 47, 48, 47, 49, 49, 50, 51, 51, 53, 53, 53, 55, 53, 55, 53, 55, 57, 56, 57, 59, 59, 60, 61, 61, 63, 62, 61, 64, 63, 64, 67, 66, 67, 67, 69, 70, 69, 70, 71, 71, 73, 71, 73, 74, 73, 75, 75, 76, 77, 77, 79, 78, 79, 80, 79, 81, 83, 82, 83, 83, 83, 85, 85, 86, 87, 86, 89, 87, 89, 91, 89, 92, 91, 92, 91, 93, 93, 95, 95, 96, 95, 97, 99, 98, 99, 100, 101, 101, 101, 103, 103, 103, 103, 103, 103, 106, 105, 107, 109, 108, 109, 109, 109, 111, 109, 112, 111, 113, 113, 114, 115, 116, 115, 118, 117, 118, 119, 119, 121, 121, 121, 122, 125, 123, 123, 124, 125, 125, 125, 127, 127, 128, 129, 129, 131, 130, 131, 133, 131, 133, 133, 134, 135, 134, 137, 137, 137, 138, 137, 139, 141, 140, 139, 142, 141, 142, 143, 144, 145, 144, 147, 146, 149, 148, 149, 149, 151, 149, 151, 151, 151, 153, 153, 154, 153, 155, 157, 156, 157, 158],
	COMPARATOR_INC: (a, b) => a-b,
	COMPARATOR_DEC: (a, b) => b-a,

	Time() { return Math.round(_perf.now()); },

	/**
	 * Wait in milliseconds, requires a call with await keyword!
	 * @param {*} ms 
	 */
	Sleep(ms) {
		return new Promise(resolve => {
			setTimeout(() => resolve(), ms);
		});
	},

	IsPositive(value) {
		return (value >= 0 && !Object.is(value, -0));
	},

	ToBit(value, bits=8) {
		let result = (value | (1 << bits)).toString(2);
		return result.substring(result.length-bits, result.length);
	},

	BitCount(value) {
		var bits = 0
		while (value) {
			let n32 = value | 0;
			n32 -= (n32 >> 1) & 0x55555555;
			n32 = (n32 & 0x33333333) + ((n32 >> 2) & 0x33333333);
			bits += ((n32 + (n32 >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
			if(value<0x100000000)
				break;
			value /= 0x100000000;
		}
		return bits;
	},

	Get7BitSize(value, bytes=5) {
		let result = 1;
		while ((value >>= 7) && result++<bytes);
		return result-(value ? 1 : 0); // 8th bit
	},

	Random(limit = 2) { return Math.floor(Math.random() * limit); },

	Distance(pt1, pt2, max, min=0) {
		let distance = pt2 - pt1;
		max = max - min + 1;
		if(Math.abs(distance) <= Math.floor(max/2))
			return distance;
		return distance>0 ? (distance - max) : (max + distance);
	},
	Distance32(pt1, pt2) { return this.Distance(pt1, pt2, 0xFFFFFFFF); },
	Distance16(pt1, pt2) { return this.Distance(pt1, pt2, 0xFFFF); },
	AddDistance(pt, distance, max, min=0) {
		pt += distance;
		if (pt>max)
			pt-=max-min+1;
		else if (pt<min)
			pt+=max-min+1;
		return pt;
	},
	AddDistance32(pt1, pt2) { return this.AddDistance(pt1, pt2, 0xFFFFFFFF); },
	AddDistance16(pt1, pt2) { return this.AddDistance(pt1, pt2, 0xFFFF); },

	/**
	 * Convert a Uint8Array to an hexadecimal string
	 * @param {Uint8Array} buffer 
	 */
	Array2Hex(buffer) {
		return Array.prototype.map.call(new Uint8Array(buffer), x => ('0' + x.toString(16)).slice(-2)).join('');
	},

	/**
	 * Convert an hexadecimal string to a UInt8Array (2 chars => 1 byte)
	 * @param {string} str 
	 */
	Hex2Array(str) {
		let buffer = [];
		for (let i = 0; i < str.length; i += 2)
			buffer.push(parseInt(str.substring(i, i+2), 16));

		return buffer;
	},

	ToBase64(data) {
		return btoa(String.fromCharCode.apply(null, data));
	},
	FromBase64(str) {
		return atob(str).split('').map( (c) => c.charCodeAt(0));
	},

	UnpackURL(url) {
		let result = document.createElement('a');
		result.href = url;
		return result;
	},

	UnpackQuery(query) {
		let params = {};
		if(query.charAt(0)=="?")
			query = query.substring(1);
		let subUrl;
		for (let key of query.split('&')) {
			let value = key.indexOf('=');
			if(value>=0) {
				value = key.substring(value+1);
				key = key.substring(0, key.length - value.length - 1);
			} else
				value = "true";
			if (!key)
				continue; // no key, for example "&&"

			if(!subUrl) {
				// search '?' after '/' => sub url
				if(value.indexOf('?')>value.indexOf('/'))
					subUrl = key;
				params[key] = value;
			} else
				params[subUrl] += "&" + key + "=" + value;
			
		}
		return params;
	},

	/**
	 * Javascript does only support 32 bits bitwise operations for now
	 * so these functions replace the 32 bits bitwise operations for 64 bit integers
	 */
	LShift(value, bits) {
		return value * Math.pow(2, bits);
	},
	RShift(value, bits) {
		return Math.floor(value / Math.pow(2, bits));
	},
	Or(val1,val2) {
		let left1 = val1 / 0x100000000;
		let right1 = val1 | 0;
		let left2 = val2 / 0x100000000;
		let right2 = val2 | 0;
		return (left1 | left2) * 0x100000000 + (right1 | right2);
	},
	And(val1, val2) {
		let left1 = val1 / 0x100000000;
		let right1 = val1 | 0;
		let left2 = val2 / 0x100000000;
		let right2 = val2 | 0;
		return (left1 & left2) * 0x100000000 + (right1 & right2);
	}
}
