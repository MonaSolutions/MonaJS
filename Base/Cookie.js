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
