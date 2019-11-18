
String.ReplaceAt = function(string, index, char) {
	return string.substring(0, index) + char + string.substring(index + 1);
}
/**
 * IP string from IP array
 * @param {IP} ip 
 */
String.FromIP = function(ip) {
	let result = "";
	if(ip.length<=4) {
		for (let i=0; i<4; ++i) {
			if(i)
				result += '.';
			result += (i<ip.length ? ip[i].toString() : '0');
		}
		return result;
	}
	// IPv6
	let shortcut = 0;
	if(ip.length<16)
		ip.unshift.call(ip, new Array(16-ip.length)); // at 0 at the beginning!
	for (let i=0; i<16; ++i) {
		if(i && shortcut<4)
			result += ':';
		let byte1 = ip[i];
		let byte2 = ip[++i];
		if(!byte1 && !byte2 && shortcut>=0) {
			// i>=1
			shortcut += Math.min(i,2);
			continue;
		}
		if(shortcut)
			shortcut = -1;
		result += (byte1<<8 | byte2).toString(16);
	}
	return result;
}

/**
 * IP string to IP array
 * @param {string} value 
 */
String.ToIP = function(value) {
	if (value.search(".local")!=-1)
		return [127, 0, 0, 1]; // Handle .local addresses (TODO: handle properly .local addresses in SDP?)
	let size = value.indexOf(':')>=0 ? 16 : 4;
	let result = new Array();
	let e = NaN;
	for (let field of value.split(size==4 ? '.' : ':')) {
		if(field.indexOf('.')>=0) {
			result.push(...this.ToIP(field));
			continue;
		}
		field =  parseInt(field, size == 4 ? 10 : 16);
		if(isNaN(field)) {
			if(isNaN(e)) {
				e = result.length;
				continue;
			}
			field = 0;
		}
		if(size == 16)
			result.push((field>>8)&0xFF);
		result.push(field&0xFF);
	}
	if(!isNaN(e)) {
		while(result.length<size)
			result.splice(e++, 0, 0);
	}
	return result;
}

/**
 * Split string address to [ ip, port] array
 * @param {string} value 
 */
String.SplitAddress = function(value) {
	let portPos = value.lastIndexOf(':');
	if(portPos<0)
		return [value]; // no port!
	let port = parseInt(value.substring(portPos+1));
	if(!port || port>0xFFFF)
		return [value]; // no port!
	return [value.substring(0, portPos), port];
}
