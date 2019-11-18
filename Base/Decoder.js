import { Media } from './Media.js';
import { Timer } from './Timer.js';
import { Util } from './Util.js';
import { TSReader } from './TSReader.js';
import { FLVReader } from './FLVReader.js';
import { MP4Reader } from './MP4Reader.js';

let BUFFER_SIZE = 0xFFFF;

export class Decoder extends Media.Source {
    onVideo(tag, data) {}
    onAudio(tag, data) {}
    onData(handler, ...params) {}
    onEnd() {}
    onClose(error=null) { if(error) console.error(error); }

    constructor(file) {
        super();
        this._started = false;
        this._realTime = 0;
        this._medias = [];
        this._start = 0;
        this._stop = BUFFER_SIZE;
        this._end = file.size;
        this._file = file;
        this._fileReader = new FileReader();
        this._fileReader.onloadend = (evt) => this.decode(evt);
        let extension = file.name.split('.').pop();
        
        if (extension.toUpperCase() === "FLV")
            this.reader = new FLVReader();
        else if (extension.toUpperCase() === "TS")
            this.reader = new TSReader();
        else if (extension.toUpperCase() === "MP4")
            this.reader = new MP4Reader();
        else {
            console.error("Unhandled extension type "+extension+", trying with TS format...");
            this.reader = new TSReader();
        }
    }

    start() {
        console.log("Starting to read file", this._file.name, "; size :", this._file.size);
        let blob = this._file.slice(this._start, this._stop + 1);
        this._fileReader.readAsArrayBuffer(blob);
    }

    decode(evt) {
        if (evt.target.readyState != FileReader.DONE) // DONE == 2
            return;
                
        this._mediaTimeGotten = false;
        this.reader.read(evt.target.result, this);

        // end of file?
        if ((this._start = this._stop+1) >= this._end) {
            this.onEnd();
            return;
        }

        // next bytes
        if ((this._stop = this._stop+BUFFER_SIZE) >= this._end)
            this._stop = this._end;
        //console.log("Next bytes : ", this._start, " - ", this._stop);
        
        if (!this._mediaTimeGotten) {
            let blob = this._file.slice(this._start, this._stop + 1);
            this._fileReader.readAsArrayBuffer(blob); // continue to read if no flush
            return; 
        }
            
        this._onTimer(); // flush        
    }

    _onTimer() {

        while (this._medias.length > 0) {
            let media = this._medias.shift();
            // TODO: if (!media)
            this.writeMedia(media);
            switch (media.type) {
                default: continue;
                case Media.Type.TYPE_AUDIO:
                    if (media.tag.isConfig)
                        continue; // skip this unrendered packet and where time is sometimes unprecise
                    break;
                case Media.Type.TYPE_VIDEO:
                    if (media.tag.frame == Media.Video.Frame.CONFIG)
                        continue; // skip this unrendered packet and where time is sometimes unprecise
                    break;
            }
            let time = media.tag.time;
            let now = Util.Time();
            if (!this._realTime) {
                this._realTime = now - time;
                continue;
            }
            let delta = time - (now - this._realTime);
            if (Math.abs(delta) > 1000) {
                // more than 1 fps means certainly a timestamp progression error..
                console.warn("Reader resets horloge (delta time of "+delta+"ms)");
                this._realTime = now - time;
                continue;
            }
            if (delta<20) // 20 ms for timer performance reason (to limit timer raising), not more otherwise not progressive (and player load data by wave)
                continue;
            //source.flush();
            Timer.Set(() => { this._onTimer(); }, delta, true);
            return; // pause!
        }

        // continue to read immediately
        if (this._fileReader.readyState != FileReader.LOADING) {
            let blob = this._file.slice(this._start, this._stop + 1);
            this._fileReader.readAsArrayBuffer(blob);
        }
    }

    writeMedia(media) {
        switch (media.type) {
            case Media.Type.TYPE_AUDIO:
                return this.onAudio(media.tag, media.packet);
            case Media.Type.TYPE_VIDEO:
                return this.onVideo(media.tag, media.packet);
            case Media.Type.TYPE_DATA:
                //if (media.isProperties)
                //	return this.setProperties(media.track, media.type, media.packet)
                return this.onData(media.track, media.type, media.packet);
            default:
                console.warn("write an unknown media ", media.type);
        }
    }

    writeAudio(track, tag, packet) {
        if (!packet) {
            console.log("empty packet");
            return;
        }
        //console.log("writeAudio ", tag, packet.length);
        
        if (!this._mediaTimeGotten) 
            this._mediaTimeGotten = !tag.isConfig;
        let media = {type: Media.Type.TYPE_AUDIO, tag: new Media.Audio.Tag(), packet: packet, track: track};
        media.tag.set(tag);
        this._medias.push(media);
    }

    writeVideo(track, tag, packet) {
        if (!packet) {
            console.log("empty packet");
            return;
        }
        //console.log("writeVideo ", tag, packet.length);
        if (!this._started) {
            if (tag.frame != Media.Video.Frame.CONFIG)
                return;
            console.log("Firt video config packet received");
            this._started = true;
        }
        if (!this._mediaTimeGotten) 
            this._mediaTimeGotten = tag.frame != Media.Video.Frame.CONFIG;
        let media = {type: Media.Type.TYPE_VIDEO, tag: new Media.Video.Tag(tag), packet: packet, track: track};
        media.tag.set(tag);
        this._medias.push(media);
    }
    writeData(track, type, packet) {
        console.log("writeData ", track, type, packet.length);
    }
    setProperties(track, type) {				
        console.log("setProperties ", track, type);
    }
    reportLost(type, lost, track) {
        console.log("reportLost ", type, lost, track);
    }
    flush() {
        console.log("flush");
    }
    reset() {
        console.log("reset");
    }

    close() {
        console.log("close");
    }
};