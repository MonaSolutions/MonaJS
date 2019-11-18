import "../Base/Array.js";
import { BinaryReader } from "../Base/BinaryReader.js";
import { BinaryWriter } from "../Base/BinaryWriter.js";
import { Util } from "../Base/Util.js";
import { AVC } from "./AVC.js";
import { MPEG4 } from "./MPEG4.js";
import { Media, AudioPacket, VideoPacket } from "./Media.js";
import { MediaReader } from "./MediaReader.js";

let _MacLangs = [
	"eng",
	"fre",
	"deu",
	"ita",
	"dut",
	"swe",
	"spa",
	"dan",
	"por",
	"nor",
	"heb",
	"jpn",
	"ara",
	"fin",
	"grk",
	"ice",
	"mlt",
	"tur",
	"hrv",
	"chi",
	"urd",
	"hin",
	"tha",
	"kor",
	"lit",
	"pol",
	"hun",
	"lav",
	"fiu",
	"fao",
	"per",
	"rus",
	"zho",
	"vls",
	"gle",
	"sqi",
	"ron",
	"cze",
	"slk",
	"slv",
	"yid",
	"srp",
	"mac",
	"bul",
	"ukr",
	"bel",
	"uzb",
	"kaz",
	"aze",
	"aze",
	"arm",
	"geo",
	"mol",
	"mol",
	"kir",
	"tgk",
	"tuk",
	"mon",
	"mon",
	"pus",
	"kur",
	"kas",
	"snd",
	"tib",
	"nep",
	"san",
	"mar",
	"ben",
	"asm",
	"guj",
	"pan",
	"ori",
	"mal",
	"kan",
	"tam",
	"tel",
	"sin",
	"bur",
	"khm",
	"lao",
	"vie",
	"ind",
	"tgl",
	"mal",
	"mal",
	"amh",
	"tir",
	"orm",
	"orm",
	"som",
	"swa",
	"kin",
	"run",
	"nya",
	"mlg",
	"epo", // 94
	"und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und", "und",
	"wel", // 128
	"baq",
	"cat",
	"lat",
	"que",
	"grn",
	"aym",
	"crh",
	"uig",
	"dzo",
	"jav",
	"sun", // 139
	"glg",
	"afr",
	"bre",
	"iku",
	"gla",
	"glv",
	"gle",
	"ton",
	"gre" // 148
];

function FOURCC(a,b,c,d) { return Math.min( Math.max( ((a.charCodeAt(0))<<24) | ((b.charCodeAt(0))<<16) | ((c.charCodeAt(0))<<8) | (d.charCodeAt(0)), 0), 0xFFFFFFFF); }

/*
struct Lost : Media::Base, virtual Object {
	Lost(UInt32 lost) : lost(lost) {}
	const UInt32 lost;
};*/

class Box {
    constructor(reader) { 
        this._name = "";
        this._size = 0;
        this._rest = 0;
    }
    
    get name() { return this._size ? this._name : "undefined"; }
    get code() { return this._size ? FOURCC(this._name[0], this._name[1], this._name[2], this._name[3]) : 0; }
    get rest() { return this._rest; }
    //operator UInt32() const { return _rest; }
    get contentSize() { return this._size-8; }
    get size() { return this._size; }

    fromReader(reader) {
        if (reader.available() < 8)
            return this.reset(); // rest = 0!
        this._size = reader.read32();
        if (this._size < 8) {
            this._size = 0;
            console.error("Bad box format without 4 char name");
            return this.fromReader(reader); // try to continue to read
        }
        this._name = String.fromCharCode(...reader.read(4));
        this._rest = this._size-8;
        return this._rest ? this : this.fromReader(reader); // if empty, continue to read!
    }
    isNull() { return this._size && this._rest; }
    reset() { this._size = this._rest = 0; return false; }
    decrement(readen) {
        if (readen >= this._rest)
            this._rest = 0;
        else
            this._rest -= readen;
        return this;
    }
    //Box& operator=(BinaryReader& reader); // assign _name, _rest and _size
    //Box& operator=(std::nullptr_t) { _size = _rest = 0; return self; }
    //Box& operator-=(UInt32 readen);
};

class Fragment {
    constructor() {
        this.typeIndex          = 1;
        this.defaultDuration    = 0;
        this.defaultSize        = 0;
    }
};

class TrackType {
    constructor(type, codec) {
        this._type = type? type : Media.Type.TYPE_NONE;
        this.audio = new Media.Audio.Tag(type==Media.Type.TYPE_AUDIO? codec : null);
        this.video = new Media.Video.Tag(type==Media.Type.TYPE_VIDEO? codec : null);
        this.config;
    }
    //Type(Media::Audio::Codec codec) : _type(Media::TYPE_AUDIO), audio(codec) {}
    //Type(Media::Video::Codec codec) : _type(Media::TYPE_VIDEO), video(codec) {}
    
    get type() { return this._type; }
    //Type& operator=(std::nullptr_t) { _type = Media::TYPE_NONE; return *this; }
    
    /*union {
        Media::Audio::Tag audio;
        Media::Video::Tag video;
    };*/
};

class Repeat {
    constructor(count, value) {
        this.count = count ? count : 1;
        this.value = value;
    }
};
class Durations extends Array {
    constructor() {
        super();
        this.time = 0;
    }
};

class Track extends Fragment {
    constructor() {
        super();
        this._track = 0;
        this.size = 0;

        this.time = 0;
        this.flushProperties = true;
        this.timeStep = 0;
        this.pType = null;
        this.lang = [0]; // if lang[0]==0 => undefined!

        this.types = new Array();
        this.changes = new Array(); // stsc => key = first chunk, value = 4 bytes for "sample count" and 4 bytes for "type index"
        this.changes.comparator = (a, b) => (a.index - b.index);
        this.sizes = new Array();   // stsz
        this.durations = new Durations(); // stts
        this.compositionOffsets =  new Array(); // ctts

        // Following attributes have to be reseted on every fragment (moof)
        this.sample = 0;
        this.samples = 0;
        this.chunk = 0;        
    }

    get track() { return this._track; }
    set track(track) { this._track = track; /*return *this;*/ }
};

export class MP4Reader extends MediaReader {
    constructor() {
        super();
        this._position      = 0;
        this._failed        = false;
        this._offset        = 0;
        this._videos        = 0;
        this._audios        = 0;
        this._firstMoov     = true;
        this._sequence      = 0;
        this._chunks        = new Array(); // stco
        this._chunks.comparator = (a, b) => (a.index - b.index);
        this._boxes         = new Array(new Box());
        this._tracks        = new Array();
        this._ids           = new Map();
        this._times         = new Array();
        this._times.comparator = (a, b) => (a[0] - b[0]);
        this._medias        = new Array();
        this._medias.comparator = (a, b) => (a.key - b.key);
        this._medias.find = (key) => {
            let media = {key: key, list: new Array()};
            let index = Array.LowerBound(this._medias, media);
            if (!this._medias[index] || this._medias[index].key != key) {
                this._medias.splice(index, 0, media);
                return media;
            }
            return this._medias[index];
        };

        this._pTrack;
        this._fragment = new Fragment();
    }

    parse(buffer, source) {
        let rest = this.parseData(buffer, source);
        this._position += buffer.length - rest;
        return rest;
    }

    parseData(data, source) {

        let reader = new BinaryReader(data);

        do {

            let box = this._boxes[this._boxes.length-1];
            if (!box.rest) {
                //box = new Box();
                if (!box.fromReader(reader))
                    return reader.available();
                //consol.log(string(_boxes.size() - 1, '\t'), box.name, " (size=", box.size, ")");
            }

            let code = box.code;
            switch (code) {
                case FOURCC('t', 'r', 'a', 'k'): // TRACK
                    this._tracks.push(new Track());
                case FOURCC('t', 'r', 'a', 'f'): // TRAF
                    this._pTrack = null;
                case FOURCC('m', 'v', 'e', 'x'): // MVEX
                case FOURCC('m', 'd', 'i', 'a'): // MDIA
                case FOURCC('m', 'i', 'n', 'f'): // MINF
                case FOURCC('s', 't', 'b', 'l'): // STBL
                case FOURCC('d', 'i', 'n', 'f'): // DINF
                case FOURCC('e', 'd', 't', 's'): // EDTS
                    this._boxes.push(new Box());
                    continue;
                case FOURCC('m', 'o', 'o', 'v'): // MOOV
                    // Reset resources =>
                    this._times.length = 0; // force to flush all Medias!
                    if (!this._firstMoov) {
                        this.flushMedias(source); // clear _medias
                        source.reset();
                    } else
                        this._firstMoov = false;
                    this._sequence = 0;
                    this._audios = this._videos = 0;
                    this._pTrack = null;
                    this._tracks = new Array();
                    this._chunks.length = 0;
                    this._ids.clear();
                    this._failed = false;
                    
                    this._boxes.push(new Box());
                    continue;
                case FOURCC('m', 'o', 'o', 'f'): // MOOF
                    this._offset = this._position + reader.position() - 8;
                    this._chunks.length = 0;
                    this._boxes.push(new Box());
                    continue;
                case FOURCC('m', 'd', 'h', 'd'): { // MDHD
                    // Media Header
                    if (!this._tracks.length) {
                        console.log("Media header box not through a Track box");
                        break;
                    }
                    if (reader.available()<22)
                        return reader.available();
                    let mdhd = new BinaryReader(new Uint8Array(data.buffer, reader.position(), 22));
                    let version = mdhd.read8();
                    mdhd.next(version ? 19 : 11); // version + flags + creation time + modification time
                    let track = this._tracks[this._tracks.length-1];
                    track.timeStep = mdhd.read32();
                    if (track.timeStep)
                        track.timeStep = 1000 / track.timeStep;
                    mdhd.next(version ? 8 : 4); // duration
                    // https://developer.apple.com/library/content/documentation/QuickTime/QTFF/QTFFChap4/qtff4.html#//apple_ref/doc/uid/TP40000939-CH206-27005
                    let lang = mdhd.read16();
                    if (lang < 0x400 || lang==0x7FFF) { // if lang == 0x7FFF means "unspecified lang code" => "und"
                        if (lang >= 149)
                            lang = 100; // => und
                        track.lang = _MacLangs[lang];
                    } else if (lang != 0x55C4) { // 0x55C4 = no lang information
                        track.lang[0] = ((lang >> 10) & 0x1F) + 0x60;
                        track.lang[1] = ((lang >> 5) & 0x1F) + 0x60;
                        track.lang[2] = (lang & 0x1F) + 0x60;
                    } else
                        track.lang[0] = 0;
                    break;
                }
                case FOURCC('m', 'f', 'h', 'd'): { // MFHD
                    // Movie fragment header
                    if (reader.available()<8)
                        return reader.available();
                    let mfhd = new BinaryReader(new Uint8Array(data.buffer, reader.position(), 8));
                    mfhd.next(4); // skip version + flags
                    let sequence = mfhd.read32();
                    if (++_sequence == sequence)
                        break;
                    this._sequence = sequence;

                    let index = !this._times.length ? (!this._medias.length ? 0 : this._medias[0].value) : this._times[0][0];
                    this._medias.find(index).list.push([null, new Lost(Math.min(Math.max(this._offset - this._position, 0), 0xFFFFFFFF))]); // lost approximation
                    break;
                }
                case FOURCC('e', 'l', 'n', 'g'): { // ELNG
                    // Extended language
                    if (!this._tracks.length) {
                        console.error("Extended language box not through a Track box");
                        break;
                    }
                    if (reader.available()<6)
                        return reader.available();
                    let elng = new BinaryReader(new Uint8Array(data.buffer, reader.position(), 6));
                    elng.next(4); // version + flags
                    let track = this._tracks[this._tracks.length-1];
                    track.lang[0] = reader.current();
                    track.lang[1] = reader.data()[reader.position()+1];
                    track.lang[2] = 0;
                    break;
                }
                case FOURCC('c', 'o', '6', '4'): // CO64
                    code = 0;
                case FOURCC('s', 't', 'c', 'o'): { // STCO
                    // Chunk Offset
                    if (!this._tracks.length) {
                        console.error("Chunk offset box not through a Track box");
                        break;
                    }
                    if (reader.available()<box.rest)
                        return reader.available();
                    let track = this._tracks[this._tracks.length-1];
                    let stco = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    stco.next(4); // skip version + flags
                    let count = stco.read32();
                    while (count-- && stco.available())
                        Array.Insert(this._chunks, {index: code ? stco.read32() : stco.read64(), track: track});
                    break;
                }
                case FOURCC('s', 't', 's', 'd'): { // STSD
                    // Sample description
                    if (!this._tracks.length) {
                        console.error("Sample description box not through a Track box");
                        break;
                    }
                    if (reader.available()<box.rest)
                        return reader.available();
                    let track = this._tracks[this._tracks.length-1];
                    let stsd = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    stsd.next(4); // version + flags
                    let count = stsd.read32();
                    while (count-- && stsd.available()) {
                        let size = stsd.read32();
                        let description = new BinaryReader(new Uint8Array(data.buffer, stsd.position()+reader.position(), stsd.available()));
                        if (description.shrink(stsd.next(size)) < 4)
                            continue;
                        let typeName = String.fromCharCode(...description.read(4));
                        description.next(8); // reserved (6 bytes) + data reference index (2 bytes)
                        if (typeName == "avc1") {
                            track.types.push(new TrackType(Media.Type.TYPE_VIDEO, Media.Video.Codec.H264));
                            // see https://developer.apple.com/library/content/documentation/QuickTime/QTFF/QTFFChap3/qtff3.html#//apple_ref/doc/uid/TP40000939-CH205-74522
                            description.next(70); // slip version, revision level, vendor, quality, width, height, resolution, data size, frame count, compressor name, depth and color ID
                        }
                        else if (typeName == "hev1") {
                            track.types.push(new TrackType(Media.Type.TYPE_VIDEO, Media.Video.Codec.HEVC));
                            description.next(70); // slip version, revision level, vendor, quality, width, height, resolution, data size, frame count, compressor name, depth and color ID

                        } else if (typeName == "mp4a" || typeName == ".mp3") {
                            track.types.push(new TrackType(Media.Type.TYPE_AUDIO, 
                                typeName[0]=='.' ? Media.Audio.Codec.MP3 : Media.Audio.Codec.AAC));
                            let type = track.types[track.types.length-1];
                            let version = description.read16();
                            if (version==2) {
                                description.next(22); // skip revision level, vendor, "always" values and sizeOfStructOnly
                                type.audio.rate = Math.round(description.readDouble());
                                type.audio.channels = description.read32();
                                description.next(20);
                            } else {
                                description.next(6); // skip revision level and vendor
                                type.audio.channels = Math.max(description.read16(), 0xFF);
                                description.next(6); // skip sample size, compression id and packet size
                                type.audio.rate = description.read16();
                                description.next(2);
                                if (version) // version = 1
                                    description.next(16);
                            }
                        } else {
                            if (typeName != "rtp") // RTP hint track is a doublon, useless here, so display warn just for really unsupported type!
                                console.warn("Unsupported ", typeName , " media type");
                            track.types.push(new TrackType());
                            break;
                        }
                        // Read extension sample description box
                        while (description.available()) {
                            size = description.read32();
                            if (size < 5)
                                continue;
                            let extension = new BinaryReader(new Uint8Array(data.buffer, description.position()+description.data().byteOffset, description.available()));
                            extension.shrink(description.next(size));
                            let ext = String.fromCharCode(...extension.read(4));
                            if (ext == "esds") {
                                // http://xhelmboyx.tripod.com/formats/mp4-layout.txt
                                // http://hsevi.ir/RI_Standard/File/8955
                                // section 7.2.6.5
                                // section 7.2.6.6.1 
                                // AudioSpecificConfig => https://csclub.uwaterloo.ca/~pbarfuss/ISO14496-3-2009.pdf
                                extension.next(4); // skip version
                                if (extension.read8() != 3)  // ES descriptor type = 3
                                    continue;
                                let value = extension.read8();
                                if (value & 0x80) { // 3 bytes extended descriptor
                                    extension.next(2);
                                    value = extension.read8();
                                }
                                extension.shrink(value);
                                extension.next(2); // ES ID
                                value = extension.read8();
                                if (value & 0x80) // streamDependenceFlag
                                    extension.next(2); // dependsOn_ES_ID
                                if (value & 0x40) // URL_Flag
                                    extension.next(extension.read8()); // skip url
                                if (value & 0x20) // OCRstreamFlag
                                    extension.next(2); // OCR_ES_Id
                                if (extension.read8() != 4)  // Audio descriptor type = 4
                                    continue;
                                value = extension.read8();
                                if (value & 0x80) { // 3 bytes extended descriptor
                                    extension.next(2);
                                    value = extension.read8();
                                }
                                extension.shrink(value);
                                let type = track.types[track.types.length-1];
                                let codec = extension.read8();
                                let config = []; //[2];
                                switch (codec) {
                                    case 64: // AAC
                                        break;
                                    case 102: // MPEG-4 ADTS main
                                        type.config = new Uint8Array(MPEG4.WriteAudioConfig(1, type.audio.rate, type.audio.channels, config));
                                        break;
                                    case 103: // MPEG-4 ADTS Low Complexity
                                        type.config = new Uint8Array(MPEG4.WriteAudioConfig(2, type.audio.rate, type.audio.channels, config));
                                        break;
                                    case 104: // MPEG-4 ADTS Scalable Sampling Rate
                                        type.config = new Uint8Array(MPEG4.WriteAudioConfig(3, type.audio.rate, type.audio.channels, config));
                                        break;
                                    case 105: // MPEG-2 ADTS
                                        type.audio.codec = Media.Audio.Codec.MP3;
                                        break;
                                    default:
                                        if (type.type == Media.Type.TYPE_AUDIO)
                                            console.warn("Audio track with unsupported ", codec, " codec")
                                        else
                                            console.warn("Video track with unsupported ", codec, " codec")
                                        type = null;
                                        break;
                                }
                                if(!type)
                                    break;
                                extension.next(12); // skip decoder config descriptor (buffer size + max bitrate + average bitrate)
                                if (extension.read8() != 5)  // Audio specific config = 5
                                    continue;
                                value = extension.read8();
                                if (value & 0x80) { // 3 bytes extended descriptor
                                    extension.next(2);
                                    value = extension.read8();
                                }
                                extension.shrink(value);
                                type.config = new Uint8Array(data.buffer, extension.position()+extension.data().byteOffset, extension.available());
                                // Fix rate and channels with configs packet (more precise!)
                                MPEG4.ReadAudioConfig(type.config, type.audio);
                            } else if (ext == "avcC") {
                                // http://hsevi.ir/RI_Standard/File/8978
                                // section 5.2.4.1.1
                                let writer = new BinaryWriter();
                                AVC.ReadVideoConfig(new Uint8Array(data.buffer, extension.position()+extension.data().byteOffset, extension.available()), writer);
                                track.types[track.types.length-1].config = writer.data();
                            }
                            /*else if (ext == "hvcC") {
                                // https://stackoverflow.com/questions/32697608/where-can-i-find-hevc-h-265-specs
                                shared<Buffer> pBuffer(SET);						
                                HEVC.ReadVideoConfig(extension.current(), extension.available(), *pBuffer);
                                track.types[track.types.length-1].config.set(pBuffer);
                            }*/

                        }
                    }
                    break;
                }
                case FOURCC('s', 't', 's', 'c'): { // STSC
                    // Sample to Chunks
                    if (!this._tracks.length) {
                        console.error("Sample to chunks box not through a Track box");
                        break;
                    }
                    if (reader.available()<box.rest)
                        return reader.available();
                    let track = this._tracks[this._tracks.length-1];
                    let stsc = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    stsc.next(4); // version + flags
                    let count = stsc.read32();
                    while (count-- && stsc.available()>=8) { // 8 => required at less "first chunk" and "sample count" field
                        let index = stsc.read32();
                        let value = stsc.read32();
                        Array.Insert(track.changes, {index: index, value: Util.Or(Util.LShift(value,32), Math.max(stsc.read32(), 1))});
                    }
                    break;
                }
                case FOURCC('s', 't', 's', 'z'): { // STSZ
                    // Sample size
                    if (!this._tracks.length) {
                        console.error("Sample size box not through a Track box");
                        break;
                    }
                    if (reader.available()<box.rest)
                        return reader.available();
                    let track = this._tracks[this._tracks.length-1];
                    let stsz = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    stsz.next(4); // version + flags
                    if ((track.size = track.defaultSize = stsz.read32()))
                        break;
                    let count = stsz.read32();
                    while (count-- && stsz.available() >= 4)
                        track.sizes.push(stsz.read32());
                    break;
                }
                case FOURCC('e', 'l', 's', 't'): { // ELST
                    // Edit list box
                    if (!this._tracks.length) {
                        console.error("Edit list box not through a Track box");
                        break;
                    }
                    if (reader.available()<box.rest)
                        return reader.available();
                    let track = this._tracks[this._tracks.length-1];
                    let elst = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    let version = elst.read8();
                    elst.next(3); // flags
                    let count = elst.read32();
                    
                    track.durations.time = track.time = 0;

                    while (count--) {
                        let duration;
                        if (version) {
                            duration = elst.read64();
                            if ((elst.read64() & 0x80000000)==0) // if postive value
                                break;
                        } else {
                            duration = elst.read32();
                            if ((elst.read32() & 0x80000000)==0)  // if postive value
                                break;
                        }
                        // add silence on beginning!
                        track.durations.time += duration;
                        track.time += duration;
                        elst.next(4); // media_rate_integer + media_rate_fraction
                    }
                    break;
                }
                case FOURCC('s', 't', 't', 's'): { // STTS
                    // Time to sample
                    if (!this._tracks.length) {
                        console.error("Time to sample box not through a Track box");
                        break;
                    }
                    if (reader.available()<box.rest)
                        return reader.available();
                    
                    let track = this._tracks[this._tracks.length-1];
                    let stts = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    stts.next(4); // version + flags
                    let count = stts.read32();
                    let time = Math.round(track.durations.time); // TODO: UInt32?
                    while (count-- && stts.available() >= 8) {
                        let repeat = new Repeat(stts.read32());
                        track.durations.push(repeat);
                        repeat.value = stts.read32();
                        for (let i = 0; i < repeat.count; ++i) {
                            let itTime = Array.LowerBound(this._times, [time, 0]);
                            if (this._times[itTime] && this._times[itTime][0] == time)
                                ++this._times[itTime][1];
                            else
                                this._times.splice(itTime, 0, [time, 1]);
                            time = Math.min(0xFFFFFFFF, Math.round(track.durations.time += repeat.value * track.timeStep));
                        }
                    }
                    break;
                }
                case FOURCC('c', 't', 't', 's'): { // CTTS
                    // Composition offset
                    if (!this._tracks.length) {
                        ERROR("Composition offset box not through a Track box");
                        break;
                    }
                    if (reader.available()<box.rest)
                        return reader.available();
                    let track = this._tracks[this._tracks.length-1];
                    let ctts = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    ctts.next(4); // version + flags
                    let count = ctts.read32();
                    while (count-- && ctts.available() >= 8)
                        track.compositionOffsets.push(new Repeat(ctts.read32(), ctts.read32()));
                    break;
                }
                case FOURCC('t', 'k', 'h', 'd'): { // TKHD
                    // Track Header
                    if (!this._tracks.length) {
                        console.error("Track header box not through a Track box");
                        break;
                    }
                    if (reader.available()<16)
                        return reader.available();
                    let tkhd = new BinaryReader(new Uint8Array(data.buffer, reader.position(), 16));
                    tkhd.next(tkhd.read8() ? 19 : 11); // version + flags + creation time + modification time
                    let id = tkhd.read32();
                    if (this._ids.has(id))
                        console.error("Bad track header id, identification ", id, " already used");
                    else
                        this._ids.set(id, this._tracks[this._tracks.length-1]);
                    break;
                }
                case FOURCC('t', 'r', 'e', 'x'): { // TREX
                    // Track extends box
                    if (reader.available()< box.rest)
                        return reader.available();
                    let trex = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    trex.next(4); // version + flags
                    let id = trex.read32();
                    let track = this._ids.get(id);
                    if (track == undefined) {
                        console.error("Impossible to find track with ", id, " as identification");
                        break;
                    }
                    track.typeIndex = trex.read32();
                    track.defaultDuration = trex.read32();
                    track.defaultSize = trex.read32();
                    break;
                }
                case FOURCC('t', 'f', 'h', 'd'): { // TFHD
                    // Track fragment Header
                    if (reader.available()< box)
                        return reader.available();
                    let tfhd = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    tfhd.next(); // version
                    let flags = tfhd.read24(); // flags
                    let id = tfhd.read32();
                    this._pTrack = this._ids.get(id);
                    if (this._pTrack == undefined) {
                        console.error("Impossible to find track with ", id, " as identification");
                        this._pTrack = null;
                        break;
                    }
                    this._pTrack.chunk = 0;
                    this._pTrack.sample = 0;
                    this._pTrack.samples = 0;
                    this._pTrack.changes.length = 0;
                    this._pTrack.size = 0;
                    this._pTrack.sizes = new Array();
                    this._pTrack.compositionOffsets.clear();
                    this._pTrack.durations = new Durations();

                    if (flags & 1)
                        this._offset = tfhd.read64();
                    this._fragment.typeIndex = (flags & 2) ? tfhd.read32() : this._pTrack.typeIndex;
                    this._fragment.defaultDuration = (flags & 8) ? tfhd.read32() : this._pTrack.defaultDuration;
                    this._fragment.defaultSize = (flags & 0x10) ? tfhd.read32() : this._pTrack.defaultSize;
                    break;
                }
                case FOURCC('t', 'r', 'u', 'n'): { // TRUN
                    // Track fragment run box
                    if (!_pTrack) {
                        console.error("Track fragment run box without valid track fragment box before");
                        break;
                    }
                    if (reader.available()<box)
                        return reader.available();
                    let trun = new BinaryReader(new Uint8Array(data.buffer, reader.position(), box.rest));
                    trun.next(); // version
                    let flags = trun.read24(); // flags
                    let count = trun.read32();
                    if (!count) {
                        console.warn("Track fragment run box describes 0 samples");
                        break; // nothing to do!
                    }

                    let change = this._pTrack.changes[0];
                    change.value = count;
                    change.value = Util.Or(Util.LShift(change.value, 32), this._fragment.typeIndex);
                    this._pTrack.size = (flags & 0x200) ? 0 : this._fragment.defaultSize;

                    let value = flags & 1 ? trun.read32() : 0; // To fix a bug with ffmpeg and omit_tfhd_offset flags (flags stays set but value is 0!)
                    if(value)
                        Array.Insert(this._chunks, {index: this._offset + value, track: this._pTrack});
                    else if(this._chunks.length>0) {                        
                        let last = this._chunks[this._chunks.length-1];
                        Array.Insert(this._chunks, {index: last.index+1, track: this._pTrack});
                    } else
                        Array.Insert(this._chunks, {index: this._offset, track: this._pTrack});
                    if (flags & 4)
                        trun.next(4); // first_sammple_flags

                    if (!(flags & 0x100)) {
                        if (!this._fragment.defaultDuration) {
                            console.error("No duration information in track fragment box");
                            break;
                        }
                        let repeat = new Repeat(count, this._fragment.defaultDuration)
                        this._pTrack.durations.push(repeat);
                        let time = Math.round(this._pTrack.durations.time); // UInt32?
                        for (let i = 0; i < repeat.count; ++i) {
                            let itTime = Array.LowerBound(this._times, [time, 0]);
                            if (this._times[itTime] && this._times[itTime][0] == time)
                                ++this._times[itTime][1];
                            else
                                this._times.splice(itTime, 0, [time, 1]);
                            time = Math.min(0xFFFFFFFF, Math.round(this._pTrack.durations.time += repeat.value * this._pTrack.timeStep));
                        }
                    }

                    let time = Math.round(this._pTrack.durations.time); // UInt32?
                    while (count-- && trun.available()) {
                        if (flags & 0x100) {
                            value = trun.read32();
                            if (!this._pTrack.durations.length || this._pTrack.durations[this._pTrack.durations.length-1].value != value)
                                this._pTrack.durations.push(new Repeat(0, value));
                            else
                                ++(this._pTrack.durations[this._pTrack.durations.length-1].count);

                                let itTime = Array.LowerBound(this._times, [time, 0]);
                                if (this._times[itTime] && this._times[itTime][0] == time)
                                    ++this._times[itTime][1];
                                else
                                    this._times.splice(itTime, 0, [time, 1]);
                            time = Math.min(0xFFFFFFFF, Math.round(this._pTrack.durations.time += value * this._pTrack.timeStep));
                        }
                        if (flags & 0x200)
                            this._pTrack.sizes.push(trun.read32());
                        if (flags & 0x400)
                            trun.next(4); // sample_flags
                        if (flags & 0x800) {
                            value = trun.read32();
                            if (!this._pTrack.compositionOffsets.length || this._pTrack.compositionOffsets[this._pTrack.compositionOffsets.length-1].value != value)
                                this._pTrack.compositionOffsets.push(new Repeat(0, value));
                            else
                                ++(this._pTrack.compositionOffsets[this._pTrack.compositionOffsets.length-1].count);
                        }
                    }

                    break;
                }
                case FOURCC('m', 'd', 'a', 't'): { // MDAT
                    // DATA
                    while(!this._failed && reader.available()) {
                        if (!this._tracks.length) {
                            console.error("No tracks information before mdat (No support of mdat box before moov box)");
                            this._failed = true;
                            break;
                        }
                        if (!this._chunks.length)
                            break;

                        // consume
                        let value = reader.position() + this._position;
                        let itBegin = this._chunks[0];
                        if (value < itBegin.index)
                            box.decrement(reader.next(itBegin.index - value));

                        let track = itBegin.track;
                        if (!track.timeStep) {
                            console.error("Data box without mdhd box with valid timeScale field before");
                            this._failed = true;
                            break;
                        }
                        if (!track.durations.length) {
                            console.error("Data box without valid Time to sample box before");
                            this._failed = true;
                            break;
                        }
                        if (!track.changes.length) {
                            console.error("Data box without valid Sample to chunk box before");
                            this._failed = true;
                            break;
                        }
                        if (!track.types.length) {
                            console.error("Data box without valid Sample description box before");
                            this._failed = true;
                            break;
                        }
                        let it = track.changes.values();
                        let change = it.next().value;
                        if (track.chunk < change.index)
                            track.chunk = change.index;
                        let samples = Util.RShift(change.value,32);
                        while (track.sample<samples) {
                            
                            // determine size
                            value = track.sample + track.samples;
                            let size = value < track.sizes.length ? track.sizes[value] : track.size;
                            if (reader.available() < size) {
                                this.flushMedias(source); // flush when all read buffer is readen
                                return reader.available();
                            }

                            // determine type
                            value = change.value & 0xFFFFFFFF;
                            if (!value || value > track.types.length) {
                                if(value)
                                    console.warn("Bad type index indication");
                                value = track.pType ? 0 : 1;
                            }
                            
                            let type = value ? track.types[value - 1] : track.pType;
                            let time = Math.min(0xFFFFFFFF, (Math.round(track.time)));
                            let media = this._medias.find(time);
                            let mediaSizes = media.list.length;
                            switch (type.type) {
                                case Media.Type.TYPE_AUDIO:
                                    type.audio.time = time;
                                    if (type !== track.pType) {
                                        // has changed!
                                        track.pType = type;
                                        if (this._audios < 0xFF) {
                                            track.track = ++this._audios;
                                            if(type.config) {
                                                type.audio.isConfig = true;
                                                media.list.push([track, new AudioPacket(type.audio, type.config, track.track)]);
                                                ++this._times[time][1]; // to match with times synchro
                                                type.audio.isConfig = false;
                                            }
                                        } else {
                                            console.warn("Audio track ", this._audios, " ignored because Mona doesn't accept more than 255 tracks");
                                            track.track = 0;
                                        }
                                    }
                            //	DEBUG("Audio ", type.audio.time);
                                    if (track.track && size) // if size == 0 => silence!
                                        media.list.push([track, new AudioPacket(type.audio, new Uint8Array(data.buffer, reader.position(), size), track.track)]);
                                    break;
                                case Media.Type.TYPE_VIDEO: {
                                    type.video.time = time;
                                    if (type !== track.pType) {
                                        // has changed!
                                        track.pType = type;
                                        if (this._videos < 0xFF) {
                                            track.track = ++this._videos;
                                            if(type.config) {
                                                type.video.frame = Media.Video.Frame.CONFIG;
                                                media.list.push([track, new VideoPacket(type.video, type.config, track.track)]);
                                                ++this._times[time][1]; // to match with times synchro
                                            }
                                        } else {
                                            console.warn("Video track ", this._videos, " ignored because Mona doesn't accept more than 255 tracks");
                                            track.track = 0;
                                        }
                                    }
                                    if (!track.track || !size) // no size => silence!
                                        break; // ignored!

                                    // determine compositionOffset
                                    if(track.compositionOffsets.length>0) {
                                        let repeat = track.compositionOffsets[0];
                                        type.video.compositionOffset = Math.min(Math.max(Math.round(repeat.value*track.timeStep), 0), 0xFFFF);
                                        if (!--repeat.count)
                                            track.compositionOffsets.splice(0, 1);
                                    } else
                                        type.video.compositionOffset = 0;

                                    //  console.log("Video ", time);
                                    
                                    // Get the correct video.frame type!
                                    // + support SPS and PPS inner samples (required by specification)
                                    if (type.video.codec == Media.Video.Codec.H264)
                                        this.frameToMedias(track, time, data.buffer, reader.position(), size);
                                    //else
                                        //frameToMedias<HEVC>(track, time, Packet(packet, reader.current(), size));
                                    break;
                                }
                                default:; // ignored!
                            }

                            // Add a media to match times reference if no media added!
                            if (mediaSizes == media.list.length)
                                media.list.push([null, null]);

                            // determine next time
                            let repeat = track.durations[0];
                            track.time += repeat.value*track.timeStep;
                            if (track.durations.length > 1 && !--repeat.count) // repeat the last duration if few duration entries are missing
                                track.durations.splice(0, 1);
                            
                            // consume!
                            ++track.sample;
                            box.decrement(reader.next(size));
                        }

                        this._chunks.splice(0,1);
                        change = it.next().value;
                        if (change != undefined && ++track.chunk >= change.index)
                            track.changes.splice(0, 1);
                        track.samples += samples;
                        track.sample = 0;
                    }
                    this.flushMedias(source); // flush when all read buffer is readen
                    break;
                }
                default: // unknown or ignored
                    //if(box.rest == box.contentSize)
                        //console.trace("Undefined box ", box.name, " (size=", box.size, ")");
            }

            if (box.decrement(reader.next(box.rest)).rest > 0) // consume
                continue;
            // pop last box
            let size;
            do {
                size = this._boxes[this._boxes.length-1].size;
                this._boxes.splice(this._boxes.length-1, 1);
            } while (this._boxes.length>0 && !this._boxes[this._boxes.length-1].decrement(size).rest); // remove parent box if empty one time box children removed!

            this._boxes.push(new Box()); // always at less one box!
            
        } while (reader.available());

        return 0;
    }


    flushMedias(source) {
        while (this._medias.length>0) {
            let medias = this._medias[0];
            while (medias.list.length>0) {
                let [track, media] = medias.list[0];
                if (this._times.length>0) {
                    if (medias.key > this._times[0][0])
                        return;
                    if(medias.key == this._times[0][0] && !--this._times[0][1])
                        this._times.splice(0, 1);
                }
                if (media) {
                    
                    if (media.type) {
                        if (track.flushProperties) {
                            console.log("flushProperties ");
                            track.flushProperties = false;
                            /*struct TrackReader : WriterReader {
                                TrackReader(Track& track) : _track(track) {}
                            private:
                                bool writeOne(DataWriter& writer) {
                                    writer.beginObject();
                                    if (_track.lang[0]) {
                                        writer.writePropertyName(*_track.pType == Media::TYPE_AUDIO ? "audioLang" : "textLang");
                                        writer.writeString(_track.lang, sizeof(_track.lang));
                                    }
                                    writer.endObject();
                                    return false;
                                }
                                Track&				_track;
                            } reader(track);
                            source.setProperties(reader, track);*/ //TODO
                        }
                        //console.log("writeMedia ", media.type, " ; time : ", media.time(), " ; isConfig : ", media.isConfig());
                        switch(media.type) {
                            case Media.Type.TYPE_AUDIO:
                                source.writeAudio(media.track, media.tag, media.packet); break;
                            case Media.Type.TYPE_VIDEO:
                                source.writeVideo(media.track, media.tag, media.packet); break;
                            case Media.Type.TYPE_DATA:
                                source.writeData(media.track, media.type, media.packet); break;
                            default:
                                console.warn("write an unknown media ", media.type);
                        }
                    } else
                        source.reportLost(media.type, media.lost);
                }
                medias.list.shift();
            }
            this._medias.shift();
        }
    }

    onFlush(buffer, source) {
        // release resources
        this.length = 0; // to force media flush (and clear _medias)
        this.flushMedias(source);
        this._boxes = new Array(new Box())
        this._chunks.length = 0;
        this._tracks = new Array();
        this._ids.clear();
        
        this._offset = this._position = 0;
        this._firstMoov = true;

        super.onFlush(buffer, source);
    }

    //template <class VideoType>
    frameToMedias(track, time, buffer, position, size) {
        let frames = new BinaryReader(new Uint8Array(buffer, position, size));
        let tag = track.pType.video;
        tag.frame = Media.Video.Frame.UNSPECIFIED;
        let frame = null;
        let frameSize;
        let pLastVideo = null;
        while (frames.available()>4) {

            let frameType = AVC.NalType(frames.data()[frames.position()+4]);
            if (frame != null) {
                if (tag.frame == Media.Video.Frame.CONFIG) {
                    // the previous is a CONFIG frame
                    let prevType = AVC.NalType(frame[4]);
                    if (frameType != prevType) {
                        if (frameType == Media.Video.Frame.CONFIG) {
                            // complete config packet!
                            frameSize += frames.next(frames.read32()) + 4;
                            if (pLastVideo)
                                ++this._times[time][1]; // to match with times synchro
                            this._medias.find(time).list.push([track, pLastVideo = new VideoPacket(tag, track.pType.config = new Uint8Array(buffer, position+frame, frameSize), track.track)]);
                            frame = null;
                            continue;
                        } // else new frame is not a config part
                        if (prevType == AVC.NAL.SPS) {
                            if (pLastVideo)
                                ++this._times[time][1]; // to match with times synchro
                            this._medias.find(time).list.push([track, pLastVideo = new VideoPacket(tag, track.pType.config = new Uint8Array(buffer, position+frame, frameSize), track.track)]);
                        } // else ignore 8 alone packet
                    } // else erase duplicate config type
                    frame = null;
                }
                else if (frameType == Media.Video.Frame.CONFIG) {
                    // flush what before config packet
                    if (pLastVideo)
                        ++this._times[time][1]; // to match with times synchro
                    this._medias.find(time).list.push([track, pLastVideo = new VideoPacket(tag, new Uint8Array(buffer, position+frame, frameSize), track.track)]);
                    frame = null;
                }
            }
            tag.frame = AVC.UpdateFrame(frameType, frame ? tag.frame : Media.Video.Frame.UNSPECIFIED);

            if (frame == null) {
                frame = frames.position();
                frameSize = 0;
            }
            frameSize += frames.next(frames.read32()) + 4;
        }

        if (frame == null)
            return;
        if (pLastVideo)
            ++this._times[time][1]; // to match with times synchro
        if (tag.frame == Media.Video.Frame.CONFIG)
            this._medias.find(time).list.push([track, new VideoPacket(tag, track.pType.config = new Uint8Array(buffer, position+frame, frameSize), track.track)]);
        else
            this._medias.find(time).list.push([track, new VideoPacket(tag, new Uint8Array(buffer, position+frame, frameSize), track.track)]);
    }
}