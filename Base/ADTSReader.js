import { BinaryReader } from "./BinaryReader.js";
import { Media } from "./Media.js";
import { MediaTrackReader } from "./MediaReader.js";
import { MPEG4 } from "./MPEG4.js";

export class ADTSReader extends MediaTrackReader {

    // Compatible AAC and MP3
	// http://wiki.multimedia.cx/index.php?title=ADTS
	// http://blog.olivierlanglois.net/index.php/2008/09/12/aac_adts_header_buffer_fullness_field
	// http://thompsonng.blogspot.fr/2010/06/adts-audio-data-transport-stream-frame.html
	// http://thompsonng.blogspot.fr/2010/03/aac-configuration.html
	constructor(track) {
        super(track);
        this._syncError = false;
        this._size = 0;
        this._tag = new Media.Audio.Tag();
        this._infos = 0;
    }

    parse(data, source) {
	
        let reader = new BinaryReader(data);

        while (reader.available()) {

            if (!this._size) {
                let header = new Uint8Array(data.buffer, reader.position());
                if (reader.available() < 7)
                    return reader.available();

                // 2 first bytes (syncword)
                if (header[0] != 0xFF || (header[1] & 0xF0) != 0xF0) {
                    if (!this._syncError) {
                        console.warn("ADTS syncword xFFF not found");
                        this._syncError = true;
                    }
                    reader.next(header[0] != 0xFF ? 1 : 2);
                    continue;
                }
                this._syncError = false;

                // CRC ?
                let headerSize = header[1] & 0x01 ? 7 : 9;
                if (reader.available() < headerSize)
                    return reader.current()-header;
                reader.next(headerSize);

                let isAACMP2 = header[1] & 0x08 ? true : false;

                this._size = (header[4] << 3) | ((header[5] & 0xe0) >> 5);
                if (!isAACMP2)
                    this._size |= (header[3] & 0x03) << 11;
                if (this._size < headerSize) {
                    this._size = 0;
                    console.warn("ADTS Frame ", this._size, " size error (inferior to header)");
                    continue;
                }
                this._size -= headerSize;

                // codec from Audio Object Type => https://wiki.multimedia.cx/index.php?title=MPEG-4_Audio#Audio_Object_Types
                let value = header[2] >> 6;
                if ((this._infos >> 12) != value) {
                    // changed!
                    this._infos |= value<<12;
                    this._tag.isConfig = true;
                }
                this._tag.codec = value>30 && value<34 ? Media.Audio.Codec.MP3 : Media.Audio.Codec.AAC;

                value = (header[2] >> 2) & 0x0f;
                if (((this._infos >> 8) & 0x0F) != value) {
                    // changed!
                    this._infos |= value << 8;
                    this._tag.isConfig = true;
                }
                this._tag.rate = MPEG4.RateFromIndex(value);

                // time
                this._tag.time = this.time;
                // advance next time!
                this.time += Math.min(Math.round(1024000.0/ this._tag.rate), 0xFFFF); // t = 1/rate... 1024 samples/frame and srMap is in kHz

                // one private bit
                this._tag.channels = ((header[2] & 0x01) << 2) | ((header[3] >> 6) & 0x03);
                // if tag.channels==0 => info in inband PCE = too complicated to get, assumed than it's stereo (TODO?)
                // Keep it because WMP is unable to read inband PCE (so sound will not worked)
                if (!this._tag.channels)
                    this._tag.channels = 2;
                if ((this._infos & 0xFF) != this._tag.channels) {
                    // changed!
                    this._infos |= this._tag.channels;
                    this._tag.isConfig = true;
                }

                // Config header
                if (this._tag.isConfig) {
                    // http://wiki.multimedia.cx/index.php?title=MPEG-4_Audio
                    // http://thompsonng.blogspot.fr/2010/03/aac-configuration.html
                    // http://www.mpeg-audio.org/docs/w14751_(mpeg_AAC_TransportFormats).pdf
                    let config = [];
                    // ADTS profile 2 first bits => MPEG-4 Audio Object Type minus 1
                    MPEG4.WriteAudioConfig((header[2] >> 6) + 1, value, this._tag.channels, config);
                    source.writeAudio(this.track, this._tag, new Uint8Array(config));
                    this._tag.isConfig = false; // just one time
                }
                
            }

            if(reader.available()<this._size)
                return reader.available();
        
            source.writeAudio(this.track, this._tag, new Uint8Array(data.buffer, reader.position(), this._size));
            reader.next(this._size);
            this._size = 0;
        };

        return 0;
    }

    onFlush(buffer, source) {
        if (this._size)
            source.writeAudio(this.track, this._tag, buffer);
        this._size = 0;
        this._infos = 0;
        this._syncError = false;
        super.onFlush(buffer, source);
    }
};
