/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

import "./String.js";
import "./Array.js";
import { Util } from "./Util.js";
import { BinaryReader } from "./BinaryReader.js";

/**
 * SDP.js contains util functions for SDP building or parsing
 */
export let SDP = {

	TYPE_OFFER: "offer",
	TYPE_ANSWER: "answer",

	/**
	 * sdp object from sdp string
	 * @param {string} lines 
	 */
	FromString(lines) {
		if (typeof(lines) != "string")
			return lines;
		let sdp = new Array();
		let media = sdp;
		lines = lines.trim().split(/\s*[\r\n]+\s*/g);
		let fingerprint;
		for (let line of lines) {
			let key = line[0], value = line.substring(line.indexOf('=') + 1).trimLeft();
			if (key.toLowerCase() == 'a') {
				key = this.AddAttribute(media, value);
				if(sdp==media && key.toLowerCase()=="fingerprint")
					fingerprint = media.fingerprint;
			} else {
				if (key.toLowerCase() == 'm') {
					sdp.push(media = {m: value});
					if(fingerprint)
						media.fingerprint = fingerprint;
					continue;
				}
				media[key] = value;
			}	
		}
		return sdp;
	},
	/**
	* sdp object to sdp string
	* @param {Object} obj 
	*/
	ToString(sdp) {
		if (typeof(sdp) == "string")
			return sdp;
		let medias = new Array();
		// https://www.cl.cam.ac.uk/~jac22/books/mm/book/node182.html
		let lines = sdp.v!==undefined ? ("v=" + sdp.v + "\n") : "";
		if(sdp.o!==undefined)
			lines += "o=" + sdp.o + "\n";
		if(sdp.s!==undefined)
			lines += "s=" + sdp.s + "\n";
		for(let key of Object.keys(sdp)) {
			if(key=='v' || key=='o' || key=='s')
				continue;
			let value = sdp[key];
			let index = parseInt(key);
			if(!isNaN(index)) {
				medias[index] = value;
				continue;
			}
			for(let i=0; i< (value.length || 1); ++i) { // value can be numeric!
				let line = value;
				if(Array.isArray(line) && value.length)
					line = value[i];
				else
					i = value.length || 1; // no more loop!
				if (key.length > 1) {
					lines += "a=" + key;
					if(line)
						lines += ":";
				} else
					lines += key + "=";
				lines += line.toString() + "\n";
			}
		};
		for(let media of medias)
			lines += this.ToString(media);
		return lines;
	},

	AddAttribute(sdp, attribute) {
		if (!(sdp instanceof Object))
			throw new Error("Can't add SDP attribute on a no-object");

		let key = attribute.indexOf(":");
		let value;
		if(key>=0) {
			value = attribute.substring(key+1).trim();
			key = attribute.substring(0,key);
		} else {
			key = attribute;
			value = "";
		}

		let oldValue = sdp[key];
		if(!oldValue)
			sdp[key] = value;
		else if(Array.isArray(oldValue))
			oldValue.push(value);
		else
			sdp[key] = new Array(oldValue, value);
		return key;
	},
	/**
	 * Create SDP from medias: medias contains m-list + sdp init properties
	 * @param {*} sdp 
	 */
	Create(...medias) {
		let sdp = Object.assign(new Array(), {
			v: 0,
			s: '-',
			t: "0 0",
			'msid-semantic': 'WMS'
		});
		let fingerprint = null;
		for(let media of medias) {
			if(!fingerprint && media.fingerprint)
				fingerprint = media.fingerprint.trimLeft();
			if(media.m)
				sdp.push(media);
			else
				Object.assign(sdp, media);	
		}
		if(!sdp.o) {
			let idSession = 1; // must be representable on 64 bits https://www.ietf.org/rfc/rfc3264.txt
			if(fingerprint && (fingerprint = fingerprint.substring(fingerprint.length-95).trim().split(":")).length>=4) {
				for(let i=0; i<8; ++i)
					idSession *= parseInt(fingerprint[i], 16);
			} else
				idSession = (sdp.negotiation || Util.Random(0xFFFFFFFFFFFFFFFF)) 
			sdp.o = "- " + idSession + " 0 IN IP4 127.0.0.1"; // max=976 611 026 837 715 150, determinate from fingerprint
		}
		if(!sdp.group) { // if not already set in custom sdp!
			for(let media of sdp) {
				if(media.mid)
					sdp.group = (sdp.group || "BUNDLE") + " " + media.mid;
			}
		}
		return sdp;
	},
	/**
	 * Serialize media
	 * @param {Object} media 
	 */
	WriteMedia(writer, media) {
		let fingerprint = media.fingerprint;
		if(fingerprint) {
			if (!fingerprint.startsWith("sha-256"))
				throw new Error("Unknown fingerprint");
			fingerprint = fingerprint.substring(fingerprint.length-95).trim().split(":");
			if (fingerprint.length != 32)
				throw new Error("Invalid fingerprint");
			for(let val of fingerprint)
				writer.write8(parseInt(val, 16));
		}
		let value = media["ice-ufrag"]; 
		if(value)
			writer.write8(value.length).write(value);
		value = media["ice-pwd"]; 
		if(value)
			writer.write8(value.length).write(value);
		// Serialize candidates
		// candidate.candidate = "candidate:202810205 1 udp 2113937151 192.168.1.21 " + localConnection.port + " typ host"
		// new RTCIceCandidate({ sdpMid: "data", sdpMLineIndex: 0, candidate : candidate })
		let candidates = new Array();
		for(let candidate of (Array.isArray(media.candidate) ? media.candidate : new Array(media.candidate))) {
			let fields = candidate.split(/\s+/);
			if(fields[1]!=1 || fields[2].toLowerCase()!="udp") // if different of UDP ignore it!
				continue;
			fields[0] = parseInt(fields[0]);
			fields[3] = parseInt(fields[3]);
			fields[4] = String.ToIP(fields[4]);
			candidates.push(fields)
		}

		let lastIp = null;
		let values = new Array();
		for(let candidate of candidates.sort((a,b) => b[3]-a[3])) { // sort by priority descending
			let ip = candidate[4];
			ip.isPublic = candidate[7].toLowerCase() != "host";
			if(!Array.Equal(ip, lastIp) || values[values.length-1].length>=0x3F) {
				// ip change, write ip!
				values.push(ip);
				values.push(new Map());
			} else if(!ip.isPublic)
				values[values.length-2].isPublic = false; // same IP in private and public => is Private (STUN resolution was useless)
			values[values.length-1].set(candidate[5], true); // add port
			lastIp = ip;
		}
		for(let i=0; i<values.length; ++i) {
			let ip = values[i++];
			 // flag isPublic + flag IPv6 + number of port
			writer.write8((ip.isPublic ? 0x80 : 0) | (ip.length>4 ? 0x40 : 0) | (values[i].size & 0x3F));
			writer.write(ip);
			for(let [port] of values[i])
				writer.write16(port);
		}
		return writer;
	},
	/**
	 * Unserialize candidates
	 * @param {BinaryReader} reader 
	 */
	ReadMedia(reader, type, media = { m:"application 9 DTLS/SCTP 5000", sctpmap: "5000 webrtc-datachannel 1024"}) {
		if(!type)
			throw new Error("type missing parameter in SDP.ReadMedia call");
		if(!media.fingerprint) {
			if(reader.available()<32)
				throw new Error("Invalid fingerprint reading");
			media.fingerprint = "sha-256 ";
			for(let i=0; i<32; ++i) {
				if(i)
					media.fingerprint += ":";
				media.fingerprint += ('0' + reader.read8().toString(16).toUpperCase()).slice(-2); // Firefox requires fingerprint in uppercase!
			}
		}
		Object.assign(media, {
			c: "IN IP4 0.0.0.0",
			'ice-options': "trickle",
			setup: type == this.TYPE_OFFER ? "actpass" : "active"
		});
		if(!media["ice-ufrag"])
			media["ice-ufrag"] = String.fromCharCode(...reader.read(reader.read8()));
		if(!media["ice-pwd"])
			media["ice-pwd"] = String.fromCharCode(...reader.read(reader.read8()));
		let mid = media.m && media.m.indexOf(" ");
		if(mid)
			media.mid = mid>=0 ? media.m.substring(0, mid) : media.m;

		// Unserialize candidates
		// candidate.candidate = "candidate:202810205 1 udp 2113937151 192.168.1.21 " + localConnection.port + " typ host"
		// new RTCIceCandidate({ sdpMid: "data", sdpMLineIndex: 0, candidate : candidate })
		let hosts = new Array(); // hosts server/RDV addition!
		let raddresses = new Map();
		let addresses = new Array();
		let priority = 0;
		let firstRAddr;
		while(reader.available()) {
			let count = reader.read8();
			let ip = reader.read(count&0x40 ? 16 : 4);
			ip.string = String.FromIP(ip);
			ip.isPublic = count & 0x80;
			count &= 0x3F;
			if(count) {
				priority += count;
				while(count--) {
					let port = reader.read16();
					if(!ip.isPublic) {
						raddresses.set(port, ip);
						if(!firstRAddr)
							firstRAddr = {host:ip.string, port:port};
					} else if(!raddresses.has(port))
						raddresses.set(port, []);
					addresses.push([ip, port]);
				}
			} else
				hosts.push(ip);
		}
		if(!firstRAddr)
			firstRAddr = {host:"127.0.0.1", port:0};
		// add candidates
		// priority = (2^24)*(type preference [0-126]) +
		// (2^8)*(local preference [0-65535]) +
		// (2^0)*(256 - component ID) => RTP is always 1! => 255!
		// https://www.slideshare.net/saghul/ice-4414037
		let foundation = 0;
		for(let address of addresses) {
			let candidate = "candidate:" + (foundation++) + " 1 udp " + (((address[0].isPublic ? 63 : 126)<<24) + (--priority<<8) + 255) + " " + address[0].string + " " + address[1] + " typ ";
			if(address[0].isPublic) // raddr + rport mandatory on firefox!
				candidate += "srflx raddr " + firstRAddr.host + " rport " + (firstRAddr.port || address[1]);
			else
				candidate += "host";
			this.AddAttribute(media, candidate);
			let i=hosts.length;
			while(i--) {
				if(Array.Equal(hosts[i], address[0]))
					hosts.splice(i, 1); // remove element, a IP host or STUN equals already found (more right!)
			}
		}
		// add hosts!
		priority = hosts.length * raddresses.size;
		for(let host of hosts) {
			for(let [port, ip] of raddresses) {
				let candidate = "candidate:" + (foundation++) + " 1 udp " + ((--priority<<8) + 255) + " " + host.string + " " + port + " typ srflx";
				if(ip.string)
					candidate += " raddr " + ip.string + " rport " + port;
				this.AddAttribute(media, candidate);
			}
		}
		return media;
	}
}
