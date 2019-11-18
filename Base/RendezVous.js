/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

/**
 * Connect to the HTTP Rendezvous url and send a message to far peer
 * @param {string} url 
 * @param {string} message 
 */
export class RendezVous {
	constructor() {
		this._request =  null;
	}

	abort() {
		if(!this._request)
			return;
		this._request.aborted = true;
		this._request.abort();
		this._request = null;
	}

	/**
	 * onFail(code) =>
	 * - 0 for server error
	 * - 408 on timeout
	 * - 409 on double meeting (conflict, abort previous meeting)
	 * - 410 on meeting join fail (peer gone)
	 * - null on abort
	 * @param {string} url 
	 * @param {*} message 
	 */
	meet(url, message) { return new Promise((onMeet, onFail) => {
		if(this._request)
			return onFail(409);
		this._request =  new XMLHttpRequest();
		this._request.onreadystatechange = (e) => {
			let request = e.target;
			if(request.readyState != XMLHttpRequest.DONE)
				return;
			this._request = null;
			if(request.status!=200) {
				if(request.aborted)
					return onFail();
				return onFail((request.timeout || request.status==204) ? 408 : request.status);
			}
			let type = request.getResponseHeader("Content-Type");
			let message = new Uint8Array(request.response);
			onMeet({
				from: request.getResponseHeader("from"),
				message: !message.length ? null : ((type && type.startsWith("text")) ? String.fromCharCode(...message) : message)
			});
		};
		// can raise an exception, so onFail will be called with a exception (e.message)
		var a = document.createElement('a');
		a.href = url;
		let timeout = a.search.toLowerCase().search(/[?|&]timeout=/);
		if(timeout>=0) {
			let end = a.search.indexOf("&", timeout+1);
			timeout = a.search.substring(timeout, end>0 ? end : undefined);
			a.search = a.search.replace(timeout, "");
			if(a.search.length>1 && a.search[1]=='&')
				a.search = a.search.substring(2);
			url = a.origin + a.pathname + a.search;
			timeout = parseInt(timeout.substring(9));
			if(timeout)
				this._request.timeout = timeout*1000;
		}
		this._request.open("RDV", url, true);
		this._request.responseType = "arraybuffer";
		this._request.send(message);
	})}
}
