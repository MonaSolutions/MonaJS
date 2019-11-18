// https://www.html5rocks.com/en/tutorials/webgl/typed_arrays/


// 1024000.0/ [ 96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350 ] => t = 1/rate... 1024 samples/frame (in kHz)
let _Rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350, 48000, 48000 ];

export let MPEG4 = {
	ReadExpGolomb(reader) {
		var i = 0;
		while (reader.available() && !reader.read())
			++i;
		var result = reader.read(i);
		if (i > 15) {
			console.warn("Exponential-Golomb code exceeding unsigned 16 bits");
			return 0;
		}
		return result + (1 << i) - 1;
	},
	
	RateFromIndex(index) {
		return _Rates[index];
	},

	WriteAudioConfig(type, rateIndex, channels, config) {
		// http://wiki.multimedia.cx/index.php?title=MPEG-4_Audio
		// http://thompsonng.blogspot.fr/2010/03/aac-configuration.html
		// http://www.mpeg-audio.org/docs/w14751_(mpeg_AAC_TransportFormats).pdf
	
		config[0] = type << 3; // 5 bits of object type (ADTS profile 2 first bits => MPEG-4 Audio Object Type minus 1)
		config[0] |= (rateIndex & 0x0F) >> 1;
		config[1] = (rateIndex & 0x01) << 7;
		config[1] |= (channels & 0x0F) << 3;
		return config;
	},

	_ReadAudioConfig(data, out /* { rateIndex, channels } */) {
		// http://wiki.multimedia.cx/index.php?title=MPEG-4_Audio
		// http://thompsonng.blogspot.fr/2010/03/aac-configuration.html
		// http://www.mpeg-audio.org/docs/w14751_(mpeg_AAC_TransportFormats).pdf
	
		if (data.byteLength < 2) {
			console.warn("AAC configuration packet must have a minimum size of 2 bytes");
			return 0;
		}
	
		let type = data[0] >> 3;
		if (!type) {
			console.warn("AAC configuration packet invalid");
			return 0;
		}
	
		out.rateIndex = (data[0] & 3) << 1;
		out.rateIndex |= data[1] >> 7;
	
		out.channels = (data[1] >> 3) & 0x0F;
	
		return type;
	},

	ReadAudioConfig(data, out /* { rate, channels } */) {
		let type = this._ReadAudioConfig(data, out);
		if (!type)
			return 0;
		out.rate = this.RateFromIndex(out.rateIndex);
		return type;
	}
}
