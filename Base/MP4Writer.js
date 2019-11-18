import { Media } from "./Media.js";
import { BinaryWriter } from "./BinaryWriter.js";
import { AVC } from "./AVC.js";
import { Util } from "./Util.js"
import "./Array.js"

class Frame {
	constructor(tag, data) {
		if(tag) {
			this.isSync =  tag.frame === undefined || tag.frame==Media.Video.Frame.KEY; // isSync if audio or video key!
			this.time = tag.time;
			this.compositionOffset = tag.compositionOffset;
		}
		this.data = data;
		this.size = data.byteLength;
	}
};

class Frames {

	get length() { return this._frames.length; }
	get front() { return this._frames[0]; }
	get back() { return this._frames[this._frames.length-1]; }
	get started() { return this._started;}
	restart() {
		console.log("MP4 track removed");
		this._started = false;
	}
	sizeTraf() { return 60 + (this._frames.length * (this.hasCompositionOffset ? (this.hasKey ? 16 : 12) : (this.hasKey ? 12 : 8))); }

	constructor() {
		this.codec = 0;
		this.hasCompositionOffset =  false;
		this.hasKey =  false;
		this.rate = 0;
		this.lastDuration = 0;
		this.lastTime = 0;
		this.config = null;
		this.writeConfig = false;

		this._started = false;
		this._frames = new Array();
	}

	[Symbol.iterator]() {
		let i=0;;
        return { next: () => {
			let frag = this._frames[i++];
            return frag ? (frag.value = frag) : { value:null, done:true };
        }};
	}

	push(tag, packet) {
		this._frames.push(new Frame(tag, packet));
		if (!this.codec) // necessary first usage, tag.codec>0 by control in entry from writeAudio/writeVideo
			this.lastTime = this._frames[0].time; // delta = lastDuration - (front().time() - lastTime) = 0
		this.codec = tag.codec;
		this._started = true;
	}

	flush() {
		this.hasKey = this.hasCompositionOffset = false;
		let frames = this._frames;
		this._frames = new Array();
		if (this.writeConfig) {
			if(this.config)
				frames.unshift(new Frame(null, this.config));
			this.writeConfig = false;
		}
		return frames;
	}
}

export class MP4Writer {

	constructor(bufferTimeMs) {

    if (!Number.isFinite(bufferTimeMs)) {
      throw new Error('Need bufferTime argument');
    }

    console.log("MP4 bufferTime set to", bufferTimeMs, "ms");

		this._bufferTime = bufferTimeMs;
    this.flush(); // init variables!

    /**
     * @public
     * @property {(packet: Uint8Array) => boolean}
     */
    this.onWrite = null;
	}

  get codecs() { return this._codecs; }

  /**
   * @private
   * @param {Uint8Array} packet Payload data
   */
  _onWrite(packet) {
    if (this.onWrite) {
      if (!this.onWrite(packet)) {
        this.onWrite = null;
      }
    }
  }

	writeAudio(tag, data) {
		if (tag.codec != Media.Audio.Codec.AAC && tag.codec != Media.Audio.Codec.MP3) {
			if (!(this._errors & 1)) {
				this._errors |= 1;
				console.warn("Audio codec unsupported, Web MP4 supports just AAC and MP3 audio codecs");
			}
			return;
		}

	//	console.log((tag.isConfig ? "Audio config " : "Audio ") + tag.time);

		if (!this._audios.length)
			this._audios.push(new Frames());
		let audios = this._audios[0];

		if (Util.Distance32(audios.length ? audios.back.time : audios.lastTime, tag.time)<0) {
			console.warn("Non-monotonic audio timestamp, packet ignored");
			return;
		}
		if (tag.isConfig) {
			if(!Array.Equal(audios.config, data)) {
				if (audios.started)
					this._flush(true); // reset if "config" change
				audios.config = data; // after flush reset!
			}
			if (!audios.rate)  // sometimes present just config packet
				audios.rate = tag.rate; // after flush reset!
			return;
		}

		this._timeBack = tag.time;
		// flush before emplace_back, with reset if codec change (if audios, codec is set) or started
		this._flush(audios.started ? audios.codec != tag.codec : !this._buffering);
		if (!audios.rate)
			audios.rate = tag.rate;
		audios.push(tag, data);
	}

	writeVideo(tag, data) {
		if (tag.codec != Media.Video.Codec.H264) {
			if (!(this._errors & 2)) {
				this._errors |= 2;
				console.warn("Video codec unsupported, Web MP4 supports just H264 video codec");
			}
			return;
		}
		// console.log((tag.frame == Media.Video.Frame.CONFIG ? "Video config " : "Video ") + tag.time + "[+" + tag.compositionOffset + "=" + (tag.time + tag.compositionOffset) + "]");
		if (!this._videos.length)
			this._videos.push(new Frames());
		let videos = this._videos[0];

		if (Util.Distance32(videos.length ? videos.back.time : videos.lastTime, tag.time)<0) {
			console.warn("Non-monotonic video timestamp, packet ignored");
			return;
		}
		if (tag.frame == Media.Video.Frame.CONFIG) {
			if(!Array.Equal(videos.config, data)) {
				if (videos.started)
					this._flush(true); // reset if "config" change
				videos.config = data; // after flush reset!
			}
			return;
		}

		this._timeBack = tag.time;
		// flush before emplace_back, with reset if codec change (if audios, codec is set) or started
		this._flush(videos.started ? videos.codec != tag.codec : !this._buffering);
		if (tag.frame == Media.Video.Frame.KEY)
			videos.hasKey = true;
		if (tag.compositionOffset)
			videos.hasCompositionOffset = true;
		videos.push(tag, data);
	}

	flush() {
		if(this._started)
			this._flush(-1);
		// release resources
		this._videos = new Array();
		this._audios = new Array();
		// init variables
		this._buffering = true;
		this._sequence = 0;
		this._errors = 0;
		this._started = false;
		this._timeFront = this._timeBack = 0;
		this._codecs = null;
	}

	_flush(reset=0) {
		if (!this._started) {
			this._started = true;
			this._timeFront = this._timeBack;
		}

		let delta = Util.Distance32(this._timeFront, this._timeBack);
		if (!reset && delta < (this._buffering ? this._bufferTime : 100)) // wait one second to get at less one video frame the first time (1fps is the min possibe for video)
			return;

		// Search if there is empty track => MSE requires to get at less one media by track on each segment
		// In same time compute sizeMoof!
		let sizeMoof = 0;
		for (let videos of this._videos) {
			if(!videos.started)
				continue;
			if(this._sequence<14) // => trick to delay firefox play and bufferise more than 2 seconds before to start playing (when hasKey flags absent firefox starts to play! doesn't impact other browsers)
				videos.hasKey = true;
			if(!videos.length) {
				if (delta < this._bufferTime) {
					if (reset) // don't forget the reset instruction
						this._buffering = true;
					return; // wait bufferTime to get at less one media on this track!
				}
        videos.restart();
				this._buffering = true;
			} else
				sizeMoof += videos.sizeTraf();
		}
		for (let audios of this._audios) {
			if(!audios.started)
				continue;
			if(!audios.length) {
				if (delta < this._bufferTime) {
					if (reset) // don't forget the reset instruction
						this._buffering = true;
					return; // wait bufferTime to get at less one media on this track!
				}
        audios.restart();
				this._buffering = true;
			} else
				sizeMoof += audios.sizeTraf();
		}
		if (!sizeMoof) {
			// nothing to write!
			this._buffering = true;
			return;
		}

		let writer = new BinaryWriter();
		let track = 0;

		if (this._buffering) {
			this._buffering = false;
			// fftyp box => iso5....iso6mp41
			writer.write("\x00\x00\x00\x18ftyp\x69\x73\x6F\x35\x00\x00\x02\x00iso6mp41");

			// moov
			let size = writer.size();
			writer.next(4); // skip size!
			writer.write("moov");
			{	// mvhd
				writer.write("\x00\x00\x00\x6cmvhd\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x03\xe8\x00\x00\x00\x00\x00\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x40\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
				writer.write32(this._audios.length + this._videos.length + 1); // next track id
			}

			// VIDEOS
			for (let videos of this._videos) {
				if(!videos.started)
					continue;
				videos.writeConfig = true;
				// trak
				let size = writer.size();
				writer.next(4); // skip size!
				writer.write("trak");

				let sps, pps;
				let dimension = 0;
				if (videos.config && (dimension = AVC.ParseVideoConfig(videos.config))) {
					sps = dimension[0];
					pps = dimension[1];
					dimension = AVC.SPSToVideoDimension(sps);
				} else
					console.warn("No avcC configuration");

				{ // tkhd
					writer.write("\x00\x00\x00\x5ctkhd\x00\x00\x00\x03\x00\x00\x00\x00\x00\x00\x00\x00");
					writer.write32(++track);
					writer.write("\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x40\x00\x00\x00");
					writer.write16(dimension>>16).write16(0); // width
					writer.write16(dimension&0xFFFF).write16(0); // height
				}
				{ // mdia
					let size = writer.size();
					writer.next(4); // skip size!
					writer.write("mdia");
					{	// mdhd
						writer.write("\x00\x00\x00\x20mdhd\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
						writer.write32(1000); // timescale, precision 1ms
						writer.write("\x00\x00\x00\x00"); // duration
						writer.write16(0x55C4); // TODO lang (0x55C4 = undefined)
						writer.write16(0); // predefined
					}
					{	// hdlr
						writer.write("\x00\x00\x00\x21hdlr\x00\x00\x00\x00\x00\x00\x00\x00vide\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
					}
					{ // minf + smhd + dinf + dref + url + stbl + stsd + stts + stsc + stsz + stco
						let size = writer.size();
						writer.next(4); // skip size!
						writer.write("minf\x00\x00\x00\x14vmhd\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x24dinf\x00\x00\x00\x1Cdref\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x0Curl \x00\x00\x00\x01");
						{ // stbl
							let size = writer.size();
							writer.next(4); // skip size!
							writer.write("stbl");
							{ // stsd
								let size = writer.size();
								writer.next(4); // skip size!
								writer.write("stsd\x00\x00\x00\x00\x00\x00\x00\x01");

								// avc1/avc2 => get config packet in moov
								// avc3/avc4 => allow config packet dynamically in the stream itself
								// The sample entry name ‘avc1’ or 'avc3' may only be used when the stream to which this sample entry applies is a compliant and usable AVC stream as viewed by an AVC decoder operating under the configuration (including profile and level) given in the AVCConfigurationBox. The file format specific structures that resemble NAL units (see Annex A) may be present but must not be used to access the AVC base data; that is, the AVC data must not be contained in Aggregators (though they may be included within the bytes referenced by the additional_bytes field) nor referenced by Extractors.
								// The sample entry name ‘avc2’ or 'avc4' may only be used when Extractors or Aggregators (Annex A) are required to be supported, and an appropriate Toolset is required (for example, as indicated by the file-type brands). This sample entry type indicates that, in order to form the intended AVC stream, Extractors must be replaced with the data they are referencing, and Aggregators must be examined for contained NAL Units. Tier grouping may be present.

								{ // avc1 TODO => switch to avc3 when players are ready? (test video config packet inband!)
									let size = writer.size();
									writer.next(4); // skip size!
									// avc1
									// 00 00 00 00 00 00	reserved (6 bytes)
									// 00 01				data reference index (2 bytes)
									// 00 00 00 00			version + revision level
									// 00 00 00 00			vendor
									// 00 00 00 00			temporal quality
									// 00 00 00 00			spatial quality
									writer.write("avc1\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
									// 05 00 02 20			width + height
									writer.write32(dimension); // width + height
									// 00 00 00 00			horizontal resolution
									// 00 00 00 00			vertical resolution
									// 00 00 00 00			data size
									// 00 01				frame by sample, always 1
									writer.write("\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01");
									// 32 x 0				32 byte pascal string - compression name
									writer.write("\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
									// 00 18				depth (24 bits)
									// FF FF				default color table
									writer.write("\x00\x18\xFF\xFF");

									if (sps) {
										// file:///C:/Users/mathieu/Downloads/standard8978%20(1).pdf => 5.2.1.1
										let size = writer.size();
										AVC.WriteVideoConfig(writer.next(4).write("avcC"), sps, pps);
										(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
										if(this._codecs)
											this._codecs += ", avc1.";
										else
											this._codecs = "avc1.";
										for(let j=1; j<4; ++j) {
											let value = sps[j];
											if(value<16)
												this._codecs += "0";
											this._codecs += value.toString(16);
										}
									}
									(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
								} // avc1
								(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
							} // stsd
							// stts + stsc + stsz + stco =>
							writer.write("\x00\x00\x00\x10stts\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x10stsc\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x14stsz\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x10stco\x00\x00\x00\x00\x00\x00\x00\x00");
							(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
						}
						(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
					}  // minf + smhd + dinf + dref + url + stbl + stsd + stts + stsc + stsz + stco
					(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
				} // mdia
				(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
			} // VIDEOS

			// AUDIOS
			for (let audios of this._audios) {
				if(!audios.started)
					continue;
				// trak
				let size = writer.size();
				writer.next(4); // skip size!
				writer.write("trak");
				{ // tkhd
					writer.write("\x00\x00\x00\x5ctkhd\x00\x00\x00\x03\x00\x00\x00\x00\x00\x00\x00\x00");
					writer.write32(++track);
					writer.write("\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x40\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
				}
				{ // mdia
					let size = writer.size();
					writer.next(4); // skip size!
					writer.write("mdia");
					{	// mdhd
						writer.write("\x00\x00\x00\x20mdhd\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
						writer.write32(1000); // timescale, precision 1ms
						writer.write("\x00\x00\x00\x00"); // duration
						writer.write16(0x55C4); // TODO lang (0x55C4 = undefined)
						writer.write16(0); // predefined
					}
					{	// hdlr
						writer.write("\x00\x00\x00\x21hdlr\x00\x00\x00\x00\x00\x00\x00\x00soun\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
					}
					{ // minf + smhd + dinf + dref + url + stbl + stsd + stts + stsc + stsz + stco

						let size = 223;
						let config;
						if (audios.config) {
							if (audios.config.byteLength <= 0xFF) {
								config = audios.config;
								size += config.byteLength + 2;
							} else
								console.warn("Audio config with size of " + audios.config.byteLength + " too large for mp4a/esds box");
						} else if (audios.codec == Media.Audio.Codec.AAC)
							console.warn("Audio AAC track without any configuration packet prealoaded");

						writer.write32(size);
						writer.write("minf\x00\x00\x00\x10smhd\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x24dinf\x00\x00\x00\x1Cdref\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x0Curl \x00\x00\x00\x01");


						writer.write32(size -= 60);
						writer.write("stbl");

						writer.write32(size -= 76);
						writer.write("stsd\x00\x00\x00\x00\x00\x00\x00\x01");

						writer.write32(size -= 16);
						// mp4a version = 0, save bandwidth (more lower than 1 or 2) and useless anyway for mp4a
						// 6D 70 34 61		 mp4a
						// 00 00 00 00 00 00 reserved
						// 00 01			 data reference index
						// 00 00			 version
						// 00 00			 revision level
						// 00 00 00 00		 vendor
						// 00 02			 channels
						// 00 10			 bits
						// 00 00			 compression id
						// 00 00			 packet size
						writer.write("mp4a\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x10\x00\x00\x00\x00");
						// writer.write(".mp3\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x10\x00\x00\x00\x00"));
						// BB 80 00 00		 rate
						writer.write16(Math.min(Math.max(audios.rate, 0), 0xFFFF)).write16(0); // just a introduction indication, config packet is more precise!
																										// 00 00 00 27		 length
						writer.write32(size -= 36);
						// 65 73 64 73		 esds
						// 00 00 00 00		 version
						// http://www.etsi.org/deliver/etsi_ts/102400_102499/102428/01.01.01_60/ts_102428v010101p.pdf
						// 03
						writer.write("esds\x00\x00\x00\x00\x03");
						// 25				 length
						writer.write8(size -= 14);
						// 00 02			 ES ID
						writer.write16(track);
						// 00				 flags + stream priority
						// 04				 decoder config descriptor
						writer.write("\x00\x04");
						// 11			 length
						writer.write8(size -= 8); // size includes just decoder config description and audio config desctription

						if(this._codecs)
							this._codecs += ", mp4a.";
						else
							this._codecs = "mp4a.";
						// decoder config descriptor =>
						// http://xhelmboyx.tripod.com/formats/mp4-layout.txt
						// http://www.mp4ra.org/object.html
						// 40 MPEG4 audio, 69 MPEG2 audio
						if(audios.codec == Media.Audio.Codec.AAC) {
							writer.write8(0x40);
							this._codecs += "40";
						} else {
							writer.write8(0x69);
							this._codecs += "69";
						}

						// 15 Audio!
						// 00 00 00 buffer size = 0
						// 00 00 00 00 => max bitrate
						// 00 00 00 00 => average bitrate
						writer.write("\x15\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");

						if (config) {
							// 05				Audio config descriptor
							// 02				length
							// 11 B0			audio specific config
							writer.write8(5);
							writer.write8(config.byteLength).write(config);
							if(audios.codec == Media.Audio.Codec.AAC)
								this._codecs += "." + (config[0]>>3).toString();
						}
						// 06				SL config descriptor
						// 01				length
						// 02				flags
						writer.write("\x06\x01\x02");


						// stts + stsc + stsz + stco =>
						writer.write("\x00\x00\x00\x10stts\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x10stsc\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x14stsz\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x10stco\x00\x00\x00\x00\x00\x00\x00\x00");

					}  // minf + smhd + dinf + dref + url + stbl + stsd + stts + stsc + stsz + stco
					(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
				} // mdia
				(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
			} // AUDIOS

			// MVEX is required by spec => https://www.w3.org/TR/mse-byte-stream-format-isobmff/
			writer.write32(8 + (track * 32)); // size of mvex
			writer.write("mvex"); // mvex
			do { // track necessary superior to 0!
				// trex
				writer.write("\x00\x00\x00\x20trex\x00\x00\x00\x00");
				writer.write32(track--);
				writer.write("\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00");
			} while (track);

			(new BinaryWriter(writer.data().buffer, size, 4)).write32(writer.size() - size);
		}

		//////////// MOOF /////////////
		writer.write32(sizeMoof+=24);
		writer.write("moof");
		{	// mfhd
			writer.write("\x00\x00\x00\x10mfhd\x00\x00\x00\x00");
			writer.write32(++this._sequence); // starts to 1!
		}

		let dataOffset = sizeMoof + 8; // 8 for [size]mdat
		for (let videos of this._videos) {
			if(videos.started)
				dataOffset = this.writeTrack(writer, ++track, videos, dataOffset);
		}
		for (let audios of this._audios) {
			if(audios.started)
				dataOffset = this.writeTrack(writer, ++track, audios, dataOffset);
		}

		// MDAT
		writer.write32(dataOffset - sizeMoof);
		writer.write("mdat");

		let mediaFrames = new Array(track);
		track=0;
		for (let videos of this._videos) {
			if(videos.started)
				mediaFrames[track++] = videos.flush();
		}
		for (let audios of this._audios) {
			if(audios.started)
				mediaFrames[track++] = audios.flush();
		}
		this._timeFront = this._timeBack;
		if (reset) {
			this._buffering = true;
			if(reset>0)
				console.log("MP4 dynamic configuration change");
		}

		// onWrite in last to avoid possible recursivity (for example if onWrite call flush again: _videos or _audios not flushed!)
		// header
		this._onWrite(writer.data());
		// payload
		for (let frames of mediaFrames) {
			for (let frame of frames)
				this._onWrite(frame.data);
		}
	}

	writeTrack(writer, track, frames, dataOffset) {
		let position = writer.size();
		let sizeTraf = frames.sizeTraf();
		writer.write32(sizeTraf); // skip size!
		writer.write("traf");
		{ // tfhd
			writer.write("\x00\x00\x00\x10tfhd\x00\x02\x00\x00"); // 020000 => default_base_is_moof
			writer.write32(track);
		}
		// frames.front()->time() is necessary a more upper time than frames.lastTime because non-monotonic packet are removed in writeAudio/writeVideo
		let delta = Util.Distance32(frames.lastTime, frames.front.time) - frames.lastDuration;
		if (Math.abs(delta)>4)
			console.warn("Timestamp delta " + delta + " superior to 4 (" + frames.front.time + "-" + frames.lastTime +"-" + frames.lastDuration + ")");
		{ // tfdt => required by https://w3c.github.io/media-source/isobmff-byte-stream-format.html
		  // http://www.etsi.org/deliver/etsi_ts/126200_126299/126244/10.00.00_60/ts_126244v100000p.pdf
		  // when any 'tfdt' is used, the 'elst' box if present, shall be ignored => tfdt time manage the offset!
			writer.write("\x00\x00\x00\x10tfdt\x00\x00\x00\x00");
			writer.write32(frames.front.time - delta);
		}
		{ // trun
			writer.write32(sizeTraf-(writer.size()- position));
			writer.write("trun");
			let flags = 0x00000301; // flags = sample duration + sample size + data-offset
			if (frames.hasCompositionOffset)
				flags |= 0x00000800;
			if (frames.hasKey)
				flags |= 0x00000400;
			writer.write32(flags); // flags
			writer.write32(frames.length); // array length
			writer.write32(dataOffset); // data-offset

			let frame;
			let size = frames.writeConfig && frames.config ? frames.config.byteLength : 0;
			for (let nextFrame of frames) {
				if (!frame) {
					frame = nextFrame;
					continue;
				}
				// medias is already a list sorted by time, so useless to check here if pMedia->tag.time inferior to pNext->time()
				delta = this.writeFrame(writer, frames, size += frame.size, frame.isSync,
					Util.Distance32(frame.time, nextFrame.time),
					frame.compositionOffset, delta);
				dataOffset += size;
				size = 0;
				frame = nextFrame;
			}
			// write last
			frames.lastTime = Util.AddDistance32(frame.time, -this.writeFrame(writer, frames, size += frame.size, frame.isSync,
				frames.lastDuration ? frames.lastDuration : Util.Distance32(frame.time, this._timeBack), frame.compositionOffset, delta));
			dataOffset += size;
		}
		return dataOffset;
	}

	writeFrame(writer, frames, size, isSync, duration, compositionOffset, delta) {
		frames.lastDuration = duration;
		if (delta>=0 || duration > -delta) {
			writer.write32(duration + delta);
			delta = 0;
		} else { // delta<-duration
			writer.write32(0);
			delta += duration;
		}
		writer.write32(size); // size
		// 0x01010000 => no-key => sample_depends_on YES | sample_is_difference_sample
		// 0X02000000 => key or audio => sample_depends_on NO
		if (frames.hasKey)
			writer.write32(isSync ? 0x02000000 : 0x01010000);
		if (frames.hasCompositionOffset)
			writer.write32(compositionOffset);
		return delta;
	}
};
