import { Util } from "../Base/Util.js";

let _Rates = [ 0, 5512, 7350, 8000, 11025, 12000, 16000, 18900, 22050, 24000, 32000, 37800, 44056, 44100, 47250, 48000, 50000, 50400, 64000, 88200, 96000, 176400, 192000, 352800, 2822400, 5644800, 0, 0, 0, 0, 0, 0 ];
let _Rates2Index = {
	0: 0, 5512: 1, 7350: 2, 8000: 3, 11025: 4, 12000: 5, 16000: 6, 18900: 7, 22050: 8, 24000: 9, 32000: 10, 37800: 11, 44056: 12, 44100: 13, 
	47250: 14, 48000: 15, 50000: 16, 50400: 17, 64000: 18, 88200: 19, 96000: 20, 176400: 21,192000: 22,	352800: 23,	2822400: 24, 5644800: 25
};

export let Media = {
	Type: {
		TYPE_NONE:0,
		TYPE_DATA: 1,
		TYPE_AUDIO: 2, // => 10, to have the first bit to 1 and be compatible with Media::Pack
		TYPE_VIDEO: 3, // => 11, to have the first bit to 1 and be compatible with Media::Pack
		// these values allow to write media type on 2 bits!
	},
	Video: {
		Codec: {
			H264: 7
		},
		Frame: {
			UNSPECIFIED: 0,
			KEY: 1,
			INTER: 2,
			DISPOSABLE_INTER: 3, // just for H263
			INFO: 5,
			CC: 6,
			CONFIG: 7
		},
		Tag: class Tag {
			constructor(codec) { 
				this.time = 0;
				this.codec = codec;
				this.frame = 0;
				this.compositionOffset = 0;
			}
			set(other) {
				this.codec = other.codec;
				this.frame = other.frame;
				this.time = other.time;
				this.compositionOffset = other.compositionOffset;
				return this;
			}
		},
		Pack(writer, tag, track) {
			// 11CCCCCC FFFFF0ON [OOOOOOOO OOOOOOOO] [NNNNNNNN] TTTTTTTT TTTTTTTT TTTTTTTT TTTTTTTT
			/// C = codec
			/// F = frame (0-15)
			/// O = composition offset
			/// N = track
			/// T = time
			writer.write8((Media.Type.TYPE_VIDEO << 6) | (tag.codec & 0x3F));
			writer.write8((tag.frame << 3) | (tag.compositionOffset ? 2 : 0) | (track != 1 ? 1 : 0));
			if (tag.compositionOffset)
				writer.write16(tag.compositionOffset);
			if (track!=1)
				writer.write8(track);
			return writer.write32(tag.time); // in last to be removed easly if protocol has already time info in its protocol header
		}
	},
	Audio: {
		Codec: {
			MP3: 2,
			AAC:  10,
			MP38K_FLV: 14 // just usefull for FLV!
		},
		Tag: class Tag {
			constructor() { 
				this.rate = 0;
				this.channels = 0;
				this.isConfig = false;
				this.time = 0;
				this.codec = Media.Audio.Codec.AAC;
			}
			reset() {
				this.isConfig = false;
			}
			set(other) {
				this.codec = other.codec;
				this.isConfig = other.isConfig;
				this.time = other.time;
				this.channels = other.channels;
				this.rate = other.rate;
				return this;
			}
		},
		Pack(writer, tag, track) {
			
			// 10CCCCCC SSSSSSSS RRRRR0IN [NNNNNNNN] TTTTTTTT TTTTTTTT TTTTTTTT TTTTTTTT
			/// C = codec
			/// R = rate "index"
			/// S = channels
			/// I = is config
			/// N = track
			/// T = time
			writer.write8((Media.Type.TYPE_AUDIO << 6) | (tag.codec & 0x3F));
			writer.write8(tag.channels);
		
			let value;
			let index = _Rates2Index[tag.rate];
			if (index == undefined) {
				// if unsupported, set to 0 (to try to use config packet on player side)
				value = 0;
				console.warn(tag.rate, " non supported by Media::Pack");
			} else
				value = index << 3;
			
			if (tag.isConfig)
				value |= 2;
			if (track==1)
				writer.write8(value);
			else
				writer.write8(value & 1).write8(track);
			return writer.write32(tag.time); // in last to be removed easly if protocol has already time info in its protocol header
		}
	},
	Data: {
		Type: {
			UNKNOWN: 0,
			AMF: 1,
			AMF0: 2,
			JSON: 3,
			XMLRPC: 4,
			QUERY: 5,
			TEXT: 6,
		},
		Pack(writer, type, track) {
			// DATA => 0NTTTTTT [NNNNNNNN]
			/// N = track
			/// T = type
			if(!track)
				return writer.write8(type & 0x3F);
			return writer.write8(0x40 | (type & 0x3F)).write8(track);
		},
		Unpack: function(type, data) {
			switch(type) {
				case this.Type.JSON:
					return JSON.parse(String.fromCharCode(...data));
				case this.Type.TEXT:
					return ["@text", String.fromCharCode(...data)];
				default:
					console.warn("Unpack data type " + type + " unsupported");
			}
			return [String.fromCharCode(...data)];
		}
	},
	/*!
	To write a media part from source (just a part of one media, so no beginMedia/endMedia and writeProperties) */
	Source : class Source {
		//virtual const std::string&	name() const { static std::string Name("?");  return Name; }

		writeAudio(track, tag, packet) {}
		writeVideo(track, tag, packet) {}
		writeData(track, type, packet) {}
		setProperties(track, type, packet) {}
		reportLost(type, lost, track) {}
		flush() {}
		reset() {}

		//void setProperties(UInt8 track, const Media::Properties& properties);
		//void setProperties(UInt8 track, DataReader& reader);
		writeMedia(media) {
			switch (media.type) {
				case Media.Type.TYPE_VIDEO:
					this.writeVideo(media.track, media.tag, media.packet);
					break;
				case Media.Type.TYPE_AUDIO:
					this.writeAudio(media.track, media.tag, media.packet);
					break;
				default:
					this.writeData(media.track, media.tag, media.packet);
			}
		}
		//void writeMedia(UInt8 track, const Media::Audio::Tag& tag, const Packet& packet) { writeAudio(track, tag, packet); }
		//void writeMedia(UInt8 track, const Media::Video::Tag& tag, const Packet& packet) { writeVideo(track, tag, packet); }
		//void writeMedia(UInt8 track, Media::Data::Type type, const Packet& packet) { writeData(track, type, packet); }

		//static Source& Null();
	},
	Properties : class Properties {
		onChange(key, pValue) {}
		onClear() {}

		get timeProperties() { return this._timeProperties; }
		constructor() {
			this._timeProperties = 0;
			this._pMap = new Map();
		}

		//Properties(const Media::Data& data);

		/*setProperties(type, packet, track) {
			if (!track)
				track = 1; // by default use track=1 to never override all properties (let's it to final user in using Media::Properties directly)

			unique<DataReader> pReader(Media::Data::NewReader(type, packet, Media::Data::TYPE_TEXT));

			// clear in first this track properties!
			String prefix(track, '.');
			clear(prefix);
			prefix.pop_back();

			// write new properties
			MapWriter<Parameters> writer(self);
			writer.beginObject();
			writer.writePropertyName(prefix.c_str());
			pReader->read(writer);
			writer.endObject();

			// Save packet formatted!
			_packets.resize(type);
			_packets[type - 1].set(move(packet));
		}*/

		set(key, value) {
			let it = this._pMap.get(key);
			if (it == undefined || it != value) {
				this._pMap.set(key, value);
				this.onParamChange(key, value);
			}
			//return it.first->second;
		}
	
		onParamChange(key, pValue) {
			///_packets.clear();
			this._timeProperties = Util.Time();
			this.onChange(key, pValue);
		}
		onParamClear() {
			//_packets.clear();
			this._timeProperties = Util.Time();
			this.onClear();
		}

		//mutable std::deque<Packet>	_packets;
	},
	Unpack: function(tag, data) {
		let dataPos=0;
		if(data[0]&0x80) {
			if(data[0]&0x40) {
				// VIDEO
				tag.codec = data[0]&0x3F;
				tag.frame = data[1]>>3;
				dataPos = 2;
				if(data[1]&2) {
					tag.compositionOffset = (data[2]<<8 | data[3]);
					dataPos += 2;
				} else
					tag.compositionOffset = 0;
			} else {
				// AUDIO
				tag.codec = data[0]&0x3F;
				tag.channels = data[1];
				tag.rate = _Rates[data[2]>>3];
				tag.isConfig = data[2]&2 ? true : false;
				dataPos = 3;
			}
			if(data[2]&1) {
				tag.track = data[3];
				++dataPos;
			} else
				tag.track = 1;
			tag.time = ((data[dataPos]<<24) | (data[dataPos+1]<<16) | (data[dataPos+2]<<8) | data[dataPos+3]);
			dataPos += 4;
		} else {
			// DATA
			dataPos = 1;
			tag.type = data[0] & 0x3F;
			if(data[0]&0x40) {
				++dataPos;
				tag.track = data[1];
			} else
				tag.track = 0;
		}
		return data.subarray(dataPos);
	}
}

class Base {
	constructor(type, packet, track) {
		this.type = type? type : TYPE_NONE;
		this.track = track? track : 0;
		this.packet = packet;
	}
	//Base(Media::Type type, const Packet& packet, UInt8 track=0) : type(type), track(track), Packet(std::move(packet)) {}

	hasTime() { return this.type>Media.Type.TYPE_DATA; }
	time() { 
		switch (this.type) {
			case Media.Type.TYPE_AUDIO:
			case Media.Type.TYPE_VIDEO:
				return this.tag.time;
			default:;
		}
		return 0;
	}
	setTime(time) {
		switch (this.type) {
			case Media.Type.TYPE_AUDIO:
			case Media.Type.TYPE_VIDEO:
				this.tag.time = time;
				break;
			default:;
		}
	}

	compositionOffset() { return this.type == Media.Type.TYPE_VIDEO ? this.tag.compositionOffset : 0; }
	isConfig() {
		switch (this.type) {
			case Media.Type.TYPE_AUDIO:
				return this.tag.isConfig;
			case Media.Type.TYPE_VIDEO:
				return this.tag.frame == Media.Video.Frame.CONFIG;
			default:;
		}
		return false;
	}
};

export class AudioPacket extends Base {
	constructor(tag, packet, track) {
		super(Media.Type.TYPE_AUDIO, packet, track);
		this.tag = new Media.Audio.Tag();
		this.tag.set(tag);
	}
};

export class VideoPacket extends Base {
	constructor(tag, packet, track) {
		super(Media.Type.TYPE_VIDEO, packet, track);
		this.tag = new Media.Video.Tag();
		this.tag.set(tag);
	}
};


