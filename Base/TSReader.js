//#include "Mona/HEVC.h"
//#include "Mona/MP3Reader.h"
import { ADTSReader } from "./ADTSReader.js";
import { AVC } from "./AVC.js";
import { NALNetReader } from "./NALNetReader.js";
import { BinaryReader } from "./BinaryReader.js";
import { Media } from "./Media.js";
import { MediaReader } from "./MediaReader.js";
import { Util } from "./Util.js";


class Program {
    constructor() {
        this.type = Media.Type.TYPE_NONE;
        this._pReader = null;
        this.waitHeader = true;
        this.sequence = 0xFF;
    }
    get track() { return this._pReader? this._pReader.track : 0; }
    set track(value) { if (this._pReader) this._pReader.track = value; }
    get time() { return this._pReader? this._pReader.time : 0; }
    set time(value) { if (this._pReader) this._pReader.time = value; }
    get compositionOffset() { return this._pReader? this._pReader.compositionOffset : 0; }
    set compositionOffset(value) { if (this._pReader) this._pReader.compositionOffset = value; }
    
    read(data, source) { if (this._pReader) this._pReader.read(data, source); }
    flush(source) { if (this._pReader) this._pReader.flush(source); }

    //operator bool() const { return _pReader ? true : false; }
    //MediaTrackReader* operator->() { return _pReader; }
    //MediaTrackReader& operator*() { return *_pReader; }

    set(type, reader, source) {
        // don't clear parameters to flush just on change!
        if (this._pReader && typeof(this._pReader) == typeof(reader))
            return this;
        this.type = type;
        if (this._pReader)
            this._pReader.flush(source);
        this._pReader = reader;
        return this;
    }
    reset(source) {
        // don't reset "type" to know the preivous type in the goal of not increase audio/video track if next type is unchanged
        // don't clear parameters to flush just on change!
        if (this._pReader) {
            this._pReader.flush(source);
            delete this._pReader;
            this._pReader = NULL;
        }
        return this;
    }
}

export class TSReader extends MediaReader {

    constructor() {
        super();
        this._syncFound = false;
        this._syncError = false;
        this._crcPAT = 0;
        this._audioTrack = 0;
        this._videoTrack = 0;
        this._startTime = -1;
        this._programs = new Map();
        this._pmts = new Map();
        this._properties = new Map();
    }

    parse(data, source) {

        let input = new BinaryReader(data);

        do {
            if(!this._syncFound) {
                while (input.read8()!=0x47) {
                    if (!this._syncError) {
                        this._syncError = true;
                        console.error("TSReader 47 signature not found");
                    }
                    if (!input.available())
                        return 0;
                }
                this._syncFound = true;
                this._syncError = false;
            }

            if (input.available() < 187)
                return input.available();

            let reader = new BinaryReader(new Uint8Array(data.buffer, input.position(), 187));
            input.next(187);

            this._syncFound = false;
                
            // Now 187 bytes after 0x47
                
            // top of second byte
            let byte = reader.read8();
        //	bool tei(byte&0x80 ? true : false); // error indicator
            let hasHeader = byte &0x40 ? true : false; // payload unit start indication
    //		bool tpri(byte&0x20 ? true : false); // transport priority indication
                
            // program ID = bottom of second byte and all of third
            let pid = ((byte & 0x1f)<<8) | reader.read8();
                
            // fourth byte
            byte = reader.read8();

            //	UInt8 scramblingControl((value >> 6) & 0x03); // scrambling control for DVB-CSA, TODO?
            let hasContent = byte & 0x10 ? true : false;	// has payload data
            // technically hasPD without hasAF is an error, see spec
                
            if (byte & 0x20) { // has adaptation field
                // process adaptation field and PCR
                let length = reader.read8();
                if (length >= 7) {
                    if (reader.read8() & 0x10)
                        length -= reader.next(6);
                    /*if (reader.read8() & 0x10) {
                        length -= 6;
                        pcr = reader.read32();
                        pcr <<= 1;	
                        UInt16 extension(reader.read16());
                        pcr |= (extension>>15)&1;
                        pcr *= 300;
                        pcr += (extension&0x1FF);
                    }*/
                    --length;
                }
                reader.next(length);
            }

            if(!pid) {
                // PAT
                if (hasHeader && hasContent) // assume that PAT table can't be split (pusi==true) + useless if no playload
                    this.parsePAT(reader, source);
                continue;
            }
            if (pid == 0x1FFF)
                continue; // null packet, used for fixed bandwidth padding
            let it = this._programs.get(pid);
            if (it == undefined) {
                if (!hasHeader || !hasContent)
                    continue;
                //console.log("Searching pid ", pid, this._programs);
                if (this._pmts.get(pid) != undefined) // assume that PMT table can't be split (pusi==true) + useless if no playload
                    this.parsePSI(reader, pid, source);
                continue;
            }

            if (!it)
                continue;  // ignore unsupported track!

            // Program known!

            let sequence = byte & 0x0f;
            let lost = sequence - it.sequence;
            if (hasContent)
                --lost; // continuity counter is incremented just on playload, else it says same!
            lost = (lost & 0x0F) * 184; // 184 is an approximation (impossible to know if missing packet had playload header or adaptation field)
            // On lost data, wait next header!
            if (lost) {
                if (!it.waitHeader) {
                    it.waitHeader = true;
                    it.flush(source); // flush to reset the state!
                }
                if (it.sequence != 0xFF) // if sequence==0xFF it's the first time, no real lost, juste wait header!
                    source.reportLost(it.type, lost, it.track);
            }
            it.sequence = sequence;
        
            if (hasHeader)
                this.readPESHeader(reader, it);

            if (hasContent) {
                if (it.waitHeader)
                    lost += reader.available();
                else
                    it.read(new Uint8Array(data.buffer, input.position() + reader.position() - 187, reader.available()), source);
            }
            
        } while (input.available());

        return 0;
    }

    parsePAT(reader, source) {
        reader.next(reader.read8()); // ignore pointer field
        if (reader.read8()) { // table ID
            console.warn("PID = 0 pointes a non PAT table");
            return; // don't try to parse it
        }

        let pmts = new Map();
        let size = reader.read16() & 0x03ff;
        if (reader.shrink(size) < size)
            console.warn("PAT splitted table not supported, maximum supported PMT is 42");
        reader.next(5); // skip stream identifier + reserved bits + version/cni + sec# + last sec#

        while (reader.available() > 4) {
            reader.next(2); // skip program number
            pmts.set(reader.read16() & 0x1fff, 0xFF);  // 13 bits => PMT pids
        }
        //console.log("Generated PMTs : ", pmts);
        // Use CRC bytes as stream identifier (if PAT change, stream has changed!)
        let crc = reader.read32();
        if (this._crcPAT == crc)
            return;
        if (this._crcPAT) {
            // Stream has changed => reset programs!
            for (let it of this._programs.values()) {
                if (it)
                    it.flush(source);
            }
            this._programs.clear();
            this._properties.clear();
            this._startTime = -1;
            this._audioTrack = 0; this._videoTrack = 0;
            source.reset();
        }
        this._pmts = pmts;
        this._crcPAT = crc;
    }

    parsePSI(reader, pid, source) {
        if (!reader.available())
            return;
        // ignore pointer field
        let skip = reader.read8();
        if (skip >= reader.available())
            return;
        reader.next(skip);
        // https://en.wikipedia.org/wiki/Program-specific_information#Table_Identifiers
        switch (reader.current()) {
            case 0x02:
                reader.next();
                return this.parsePMT(reader, pid, source);
            default:;
        }
    }
            
    parsePMT(reader, pid, source) {
        let size = reader.read16() & 0x03ff;
        if (reader.shrink(size) < size)
            console.warn("PMT splitted table not supported, maximum supported programs is 33");
        if (reader.available() < 9) {
            console.warn("Invalid too shorter PMT table");
            return;
        }
        reader.next(2); // skip program number
        let value = (reader.read8()>>1)&0x1F;
        reader.next(2); // skip table sequences

        if (value == this._pmts.get(pid))
            return; // no change!

        // Change doesn't reset a source.reset, because it's just an update (new program, or change codec, etc..),
        // but timestamp and state stays unchanged!
        this._pmts.set(pid, value);

        reader.next(2); // pcrPID
        reader.next(reader.read16() & 0x0fff); // skip program info

        while(reader.available() > 4) {
            let value = reader.read8();
            let pid = reader.read16() & 0x1fff;

            let program = new Program();
            this._programs.set(pid, program);
            let oldType = program.type;
        
            //console.log("codec : ", value);
            switch(value) {
                case 0x1b: { // H.264 video
                    program.set(Media.Type.TYPE_VIDEO, new NALNetReader(AVC), source);
                    break;
                }
                case 0x24: { // H.265 video
                    console.warn("unsupported HEVC type in PMT");
                    //program.set(Media.Type.TYPE_VIDEO, new NALNetReader(HEVC), source);
                    break;
                }
                case 0x0f: { // AAC Audio / ADTS
                    program.set(Media.Type.TYPE_AUDIO, new ADTSReader(), source);
                    break;
                }
                case 0x03: // ISO/IEC 11172-3 (MPEG-1 audio)
                case 0x04: { // ISO/IEC 13818-3 (MPEG-2 halved sample rate audio)
                    console.warn("unsupported MP3 type in PMT");
                    //program.set(Media.Type.TYPE_AUDIO, new MP3Reader(), source);
                    break;
                }
                default:
                    console.warn("unsupported type ",value.toString(16)," in PMT");
                    program.reset(source);
                    reader.next(reader.read16() & 0x0fff); // ignore ESI
                    continue;
            }

            if (oldType != program.type) {
                // added or type changed!
                if (program.type == Media.Type.TYPE_AUDIO) {
                    program.track = ++this._audioTrack;
                } else if (program.type == Media.Type.TYPE_VIDEO)
                    program.track = ++this._videoTrack;
            }
            this.readESI(reader, program);
        }
        // ignore 4 CRC bytes

        // Flush PROPERTIES if changed!
        for (let [key, value] of this._properties) {
            if (value.time>=value.properties.timeProperties)
                continue; // no change
            value.time = value.properties.timeProperties;
            source.setProperties(key, value.properties);
        }
    }

    readESI(reader, program) {
        // Elmentary Stream Info
        // https://en.wikipedia.org/wiki/Program-specific_information#Table_Identifiers
        let available = reader.read16() & 0x0fff;
        while (available-- && reader.available()) {
            let type = reader.read8();
            if (type == 0xFF || !available--)
                continue; // null padding
            let size = reader.read8();
            let data = new Uint8Array(reader.data().buffer, reader.position(), size = reader.next(size));
            let desc = new BinaryReader(data);
            available -= size;
            switch (type) {
                case 0x0A: { // ISO 639 language + Audio option
                    let pos = desc.position();
                    size = desc.next(3);
                    while (size && !data[pos]) {
                        ++pos; // remove 0 possible prefix!
                        --size;
                    }
                    if(size) {
                        let prop = this._properties.get(program.track);
                        if (prop == undefined) {
                            prop = {time : Util.Time(), properties : new Media.Properties()};
                            this._properties.set(program.track, prop);
                        }
                        prop.properties.set("audioLang", new TextDecoder("utf-8").decode(new Uint8Array(data.buffer, pos, size)));
                        //this._properties[program.track].properties.setString("audioLang", STR data, size);
                    }
                    break;
                }
                case 0x86: { // Caption service descriptor http://atsc.org/wp-content/uploads/2015/03/Program-System-Information-Protocol-for-Terrestrial-Broadcast-and-Cable.pdf
                    let count = desc.read8() & 0x1F;
                    while (count--) {
                        let pos = desc.position();
                        size = desc.next(3);
                        let channel = desc.read8();
                        if (channel & 0x80) {
                            let prop = this._properties.get(program.track*4 + (channel & 0x3F));
                            if (prop == undefined) {
                                prop = {time : Util.Time(), properties : new Media.Properties()};
                                this._properties.set(program.track*4 + (channel & 0x3F), prop);
                            }
                            prop.properties.set("textLang", new TextDecoder("utf-8").decode(new Uint8Array(data.buffer, pos, size)));
                            //this._properties[program.track*4 + (channel & 0x3F)].properties.setString("textLang", STR data, size);
                        }
                        desc.next(2);
                    }
                    break;
                }
            }
            
        }
    }

    readPESHeader(reader, pProgram) {
        // prefix 00 00 01 + stream id byte (http://dvd.sourceforge.net/dvdinfo/pes-hdr.html)
        let value = reader.read32();
        let isVideo = value&0x20 ? true : false;
        if ((value & 0xFFC0)!=0x1C0) {
            console.warn("PES start code not found or not a ",isVideo ? "video" : "audio"," packet");
            return;
        }
        pProgram.waitHeader = false;
        reader.next(3); // Ignore packet length and marker bits.

        // Need PTS
        let flags = (reader.read8() & 0xc0) >> 6;

        // Check PES header length
        let length = reader.read8();

        if (flags&0x02) {

            // PTS
            let pts = ((reader.read8() & 0x0e) << 29) | ((reader.read16() & 0xfffe) << 14) | ((reader.read16() & 0xfffe) >> 1);
            length -= 5;
            pts /= 90;

            let dts;

            if(flags == 0x03) {
                // DTS
                dts = ((reader.read8() & 0x0e) << 29) | ((reader.read16() & 0xfffe) << 14) | ((reader.read16() & 0xfffe) >> 1);
                length -= 5;
                dts /= 90;

                if (pts < dts) {
                    console.warn("Decoding time ", dts, " superior to presentation time ", pts);
                    dts = pts;
                }

            } else
                dts = pts;

            // To decrease time value on long session (TS can starts with very huge timestamp)
            if (this._startTime > dts) {
                console.warn("Time ",dts," inferior to start time ", this._startTime);
                this._startTime = dts;
            } else if(this._startTime<0)
                this._startTime = dts - Math.min(200, dts); // + 200ms which is a minimum required offset with PCR (see TSWriter.cpp)
            pProgram.time = Math.min((Math.round(dts) - this._startTime), 0xFFFFFFFF);
            pProgram.compositionOffset = Math.min(Math.max(Math.round(pts - dts), 0), 0xFFFF);

            //DEBUG(isVideo ? "video " : "audio ", pProgram.track, " => ", pProgram->time, " ", pProgram->compositionOffset);
        }
        
        // skip other header data.
        if (length<0)
            console.warn("Bad ",isVideo ? "video" : "audio", " PES length")
        else
            reader.next(length);
    }

    onFlush(buffer, source) {
        for (let it of this._programs.values()) {
            if (it)
                it.flush(source);
        }
        this._programs.clear();
        this._audioTrack = 0; this._videoTrack = 0;
        this._pmts.clear();
        this._syncFound = false;
        this._syncError = false;
        this._crcPAT = 0;
        this._startTime = -1;
        super.onFlush(buffer, source);
    }
}