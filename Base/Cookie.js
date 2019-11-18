/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

export let Cookie = {

	Set(name, value, exDays=1) {
		let expires = "expires=";
		if(exDays) {
			let d = new Date();
			d.setTime(d.getTime() + (exDays*24*60*60*1000));
			expires += d.toUTCString();
		} else
			expires += "Fri, 31 Dec 9999 23:59:59 GMT";
		document.cookie = name + "=" + value + ";" + expires + ";path=/";
	},

	Get(name, defaultValue) {
		name += "=";
		let decodedCookie = decodeURIComponent(document.cookie);
		let ca = decodedCookie.split(';');
		for(let i = 0; i <ca.length; i++) {
			let c = ca[i];
			while (c.charAt(0) == ' ')
				c = c.substring(1);
			if (c.indexOf(name) == 0)
				return c.substring(name.length, c.length);
		}
		return defaultValue;
	}

}
