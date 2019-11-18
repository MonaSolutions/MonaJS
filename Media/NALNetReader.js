//#include "Mona/HEVC.h"
//import { AVC } from "./AVC.js";
import { BinaryReader } from "../Base/BinaryReader.js";
import { BinaryWriter } from "../Base/BinaryWriter.js";
import { Media } from "./Media.js";
import { MediaTrackReader } from "./MediaReader.js";

export class NALNetReader extends MediaTrackReader {
	constructor(videoType) {
		super(1); // TODO: set it configurable?
		this._tag = new Media.Video.Tag(Media.Video.Codec.H264);
		this._state = 0;
		this._type = 0xFF;
		this._videoType = videoType;
	}

	parse(data, source) {

		let reader = new BinaryReader(data);
		//const UInt8* cur(buffer.data());
		//const UInt8* end(buffer.data() + buffer.size());
		let nal = 0;	// assume that the copy will be from start-of-data

		while(reader.available()) {
			
			let value = reader.read8();

			// About 00 00 01 and 00 00 00 01 difference => http://stackoverflow.com/questions/23516805/h264-nal-unit-prefixes
		
			switch(this._state) {
				case 0:
					if(value == 0x00)
						this._state = 1;
					break;
				case 1:
					this._state = value == 0x00 ? 2 : 0;
					break;
				case 2:
					if (value == 0x00) {  // 3 zeros
						this._state = 3;
						break;
					}
				case 3:
					if(value == 0x00)  // more than 2 or 3 zeros... no problem  
						break; // state stays at 3 (or 2)
					if (value == 0x01) {
						this.writeNal(data, nal, reader.position() - nal, source, true);
						nal = reader.position();
						this._type = 0xFF; // new NAL!	
					}
				default:
					this._state = 0;
					break;
			} // switch _scState
		}

		if (reader.position() != nal)
			this.writeNal(data, nal, reader.position() - nal, source);

		return 0;
	}

	writeNal(data, offset, size, source, eon) {
		// flush just if:
		// - config packet complete (VPS, SPS & PPS)
		// - unit delimiter or nal type greater
		// - times change
		// /!\ Ignore many VLC frames are in the same NAL unit, it can be redundant coded picture
		let flush = false;
		if (this._type==0xFF) {
			// Nal begin!
			this._type = this._videoType.NalType(data[offset]);
			if (this._type >= this._videoType.NAL.AUD)
				return this.flushNal(source); // flush possible NAL waiting and ignore current NAL (_pNal is reseted)
			
			if (this._tag.frame == Media.Video.Frame.CONFIG) {
				let prevType = this._videoType.NalType(this._pNal.data()[this._position+4]);
				if (this._type == prevType) {
					this._pNal = new BinaryWriter();  // erase repeated config type and wait the other config type!
				} else if (this._videoType.Frames[this._type] != Media.Video.Frame.CONFIG) {
					if (prevType == this._videoType.NAL.SPS)
					this.flushNal(source); // flush alone SPS config (valid)
					else
						this._pNal = new BinaryWriter();  // erase alone VPS or PPS config (invalid)
					this._tag.frame = this._videoType.UpdateFrame(this._type, Media.Video.Frame.UNSPECIFIED);
				} else
					flush = true;
			} else {
				if (this._videoType.Frames[this._type] == Media.Video.Frame.CONFIG)
					this.flushNal(source); // flush everything and wait the other config type
				else if (this._tag.time != this.time || this._tag.compositionOffset != this.compositionOffset)
					this.flushNal(source); // flush if time change
				this._tag.frame = this._videoType.UpdateFrame(this._type, this._tag.frame);
			}
			if (this._pNal) { // append to current NAL
				// write NAL size
				new BinaryWriter(this._pNal.data().buffer, this._position, 4).write32(this._pNal.size() - this._position - 4); 
				// reserve size for AVC header
				this._position = this._pNal.size();
				//_pNal->resize(this._position + 4, true); 
				this._pNal.next(4);
			} else {
				this._tag.time = this.time;
				this._tag.compositionOffset = this.compositionOffset;
				this._position = 0;
				this._pNal = new BinaryWriter(4);
				this._pNal.next(4);
			}
		} else {
			if (!this._pNal)
				return; // ignore current NAL!
			if ((this._pNal.size() + size) > 0xA00000) {
				// Max slice size (0x900000 + 4 + some SEI)
				console.warn("NALNetReader buffer exceeds maximum slice size");
				this._tag.frame = Media.Video.Frame.UNSPECIFIED;
				this._pNal = null; // release huge buffer! (and allow to wait next 0000001)
				return 
			}
		}
		this._pNal.write(new Uint8Array(data.buffer, offset, size - (eon? this._state + 1 : 0))); // eon ? trim off the [0] 0 0 1
		if(flush)
			this.flushNal(source);
	}

	flushNal(source) {
		if (!this._pNal)
			return;
		// write NAL size
		new BinaryWriter(this._pNal.data().buffer, this._position, 4).write32(this._pNal.size() - this._position - 4);
		// transfer _pNal and reset _tag.frame
		if (this._tag.frame == Media.Video.Frame.CONFIG || this._pNal.size() > 4) // empty NAL valid just for CONFIG frame (useless for INTER, KEY, INFOS, etc...)
			source.writeVideo(this.track, this._tag, this._pNal.data());
		this._pNal = null;
		this._tag.frame = Media.Video.Frame.UNSPECIFIED;
	}

	onFlush(buffer, source) {
		this.flushNal(source);
		this._type = 0xFF;
		this._state = 0;
		super.onFlush(buffer, source);
	}
};
