import "../Base/Array.js";
import { BinaryWriter } from "../Base/BinaryWriter.js";
import { BinaryReader } from "../Base/BinaryReader.js";
import { MediaReader } from "./MediaReader.js";
import { Media } from "./Media.js";
import { MPEG4 } from "./MPEG4.js";
import { AVC } from "./AVC.js";

let AMF = {
	Type: {
		EMPTY				:0x00,
		CHUNKSIZE			:0x01,
		ABORT				:0x02,
		ACK				    :0x03,
		RAW				    :0x04,
		WIN_ACKSIZE		    :0x05,
		BANDWIDTH			:0x06,
		AUDIO				:0x08,
		VIDEO				:0x09,
		DATA_AMF3			:0x0F,
		INVOCATION_AMF3	    :0x11,
		DATA				:0x12,
		INVOCATION			:0x14
    }
}

export class FLVReader extends MediaReader {

    constructor() {
        super();
        this._begin = true;
        this._size = 0;
        this._type = AMF.Type.EMPTY;
        this._syncError = false;
        this._video = new Media.Video.Tag();
	    this._audio = new Media.Audio.Tag();
        this._audioConfig = new Media.Audio.Tag();
    }

    ReadAudioHeader(data, tag, config) {
        let reader = new BinaryReader(data);
        if (!reader.available()) {
            config.set(tag);
            tag.isConfig = true; // audio end
            return 0; // keep other tag properties unchanged
        }
         // empty packet => initialize isConfig = false (change everytime)
        let codecs = reader.read8();
        tag.codec = codecs >> 4;
        if(tag.codec == Media.Audio.Codec.AAC) {
            if (reader.available() && !reader.read8() && MPEG4.ReadAudioConfig(new Uint8Array(data.buffer, reader.position(), reader.available()), {rate:tag.rate, channels:tag.channels})) {
                // Use rate here of AAC config rather previous!
                tag.isConfig = true;
                config.set(tag);
            } else
                tag.isConfig = false;
        } else if (tag.codec == Media.Audio.Codec.MP38K_FLV) {
            tag.codec = Media.Audio.Codec.MP3;
            tag.rate = 8000;
        }
        tag.rate = config ? config.rate : Math.min(5512.5*Math.pow(2, ((codecs & 0x0C) >> 2)), 0xFFFFFFFF);
        tag.channels = config ? config.channels : ((codecs & 0x01) + 1);
        return reader.position();
    }

    ReadVideoHeader(data, tag) {
        let reader = new BinaryReader(data);
        if (!reader.available())
            return 0; // keep other tag properties unchanged
        let codecs = reader.read8();
        tag.codec = codecs & 0x0F;
        tag.frame = (codecs & 0xF0) >> 4;
        if (tag.codec == Media.Video.Codec.H264 /*|| tag.codec == Media.Video.Codec.HEVC*/) {
            if (!reader.read8())
                tag.frame = Media.Video.Frame.CONFIG;
            tag.compositionOffset = reader.read24();
            return 5;
        }
        tag.compositionOffset = 0;
        return 1;
    }

    parse(data, source) {
        let reader = new BinaryReader(data);

        if (this._begin) {
            if (!this._size) {
                for (;;) {
                    if (reader.available() < 9)
                        return reader.available();
                    if (reader.read24() == 0x464C56)
                        break;
                    if (!this._syncError) {
                        console.warn("FLVReader signature not found");
                        this._syncError = true;
                    }
                }
                this._syncError = false;
                reader.next(2);
                this._size = reader.read32();
                if (this._size > 9)
                    this._size -= 4;
                else
                this._size = 5;
            }
            this._begin = false;
        }

        while (reader.available()) {

            if (!this._type) {
                if (reader.available() < this._size) {
                    this._size -= reader.available();
                    return 0;
                }
                reader.next(this._size-1);
                this._type = reader.read8();
                this._size = 0;
            }
            if (!this._size) {
                if (reader.available() < 3)
                    return reader.available();
                    this._size = reader.read24()+7;
            }

            if (reader.available() < this._size)
                return reader.available();

            // Here reader.available()>=_size
            switch (this._type) {
                case AMF.Type.VIDEO: {
                    this._video.time = reader.read24() | (reader.read8() << 24);
                    let track = reader.read24();
                    this._size -= 7;
                    let content = new Uint8Array(data.buffer, reader.position(), this._size);
                    content = content.subarray(this.ReadVideoHeader(content, this._video));
                    if (this._video.frame == Media.Video.Frame.CONFIG && ((this._video.codec == Media.Video.Codec.H264) /*|| (_video.codec == Media::Video::CODEC_HEVC)*/)) {
                        let writer = new BinaryWriter();
                        /*if (_video.codec == Media::Video::CODEC_HEVC)
                            content = content.subarray(HEVC.ReadVideoConfig(content, writer));
                        else*/
                            content = content.subarray(AVC.ReadVideoConfig(content, writer));
                        source.writeVideo(track ? track : 1, this._video, writer.data());
                    }
                    if(content.byteLength) // because if was just a config packet, there is no more data!
                        source.writeVideo(track ? track : 1, this._video, content);
                    break;
                }
                case AMF.Type.AUDIO: {
                    this._audio.time = reader.read24() | (reader.read8() << 24);
                    let track = reader.read24();
                    this._size -= 7;
                    let pos = this.ReadAudioHeader(new Uint8Array(data.buffer, reader.position(), this._size), this._audio, this._audioConfig);
                    source.writeAudio(track ? track : 1, this._audio, new Uint8Array(data.buffer, reader.position()+pos, this._size-pos));
                    break;
                }
                case AMF.Type.DATA: {
                    reader.next(4); // Time!
                    let track = reader.read24();
                    this._size -= 7;
                    let current = new Uint8Array(data.buffer, reader.position(), Math.min(reader.available(), 13));
                    if (Array.Equal(current, [2, 0, 10, 111, 110, 77, 101, 116, 97, 68, 97, 116, 97]))  // "\x02\x00\x0AonMetaData"
                        source.setProperties(Media.Data.Type.AMF, new Uint8Array(data.buffer, reader.position()+13, this._size - 13), track);
                    else
                        source.writeData(Media.Data.Type.AMF, new Uint8Array(data.buffer, reader.position(), this._size), track);
                    break;
                }
                default:
                    console.warn("FLVReader with an unknown AMF type ", this._type);
            }
        
            reader.next(this._size);
            this._type = AMF.Type.EMPTY;
            this._size = 5; // footer + type
        }
        
        return 0;
    }

    onFlush(buffer, source) {
        this._begin = true;
        this._size = 0;
        this._type = AMF.Type.EMPTY;
        this._audioConfig.reset();
        this._syncError = false;
        super.onFlush(buffer, source);
    }
}
