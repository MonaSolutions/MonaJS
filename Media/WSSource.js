import { Util } from '../Base/Util.js';
import { Media } from './Media.js';

export class WSSource {
	onAudio(tag, data) {}
	onVideo(tag, data) {}
	onData(handler, ...params) {}
	onEnd() {}
	onClose(error=null) { if(error) console.error(error); }

	constructor(url) {
		this._socket = new WebSocket(url);
		this._stream = Util.UnpackURL(url).search;
		this._stream = this._stream ? this._stream.substring(1) : "test";
		this._hasParams = this._stream.indexOf("?")>=0;
		this._isEdge = window.navigator.userAgent.indexOf("Edge") > -1;

		this._socket.binaryType = "arraybuffer";
		this._socket.onopen = (event) => {
			if(this._isEdge)
				this._socket.send('["@subscribe","' + this._stream + '"]'); // Edge support just CC in video frame, so disable data track selection
			else
				this._socket.send('["@subscribe","' + this._stream + (this._hasParams ? '&data=0' : '?data=0') + '"]'); // data=0 to remove CC in video (save bandwidth)
		};
		this._socket.onmessage = (event) => {
			// audio and video data
			if(typeof(event.data)=="string") {
				let params; 
				try {
					params = JSON.parse(event.data);
				} catch(e) {
					throw new Error(e.message, ", ", event.data);
				}
				let handler = params[0];
				switch(handler) {
					case "@media":
						break;
					case "@end":
						this.onEnd();
						break;
					default:
						this.onData.apply(null, params);
				}
				return;
			}

			// Audio or Video
			let data = new Uint8Array(event.data);
			let tag = {};
			data = Media.Unpack(tag, data);
			this[tag.frame===undefined ? "onAudio" : "onVideo"](tag, data);
		};
		this._socket.onclose = (e) => {
			switch(e.code) {
                case 1000:
                    return this.close(); // normal close
                case 1001:
                    return this.close("server shutdown"); // server gone!
                default:
                    this.close(e.reason || ("connection error "+e.code));
            }
		}
	}

	setDataTrack(track) {
		if(!this._isEdge) // Edge support just CC in video frame, so disable data track selection
			this._socket.send('["@subscribe","' + this._stream + (this._hasParams ? '&data=' : '?data=') + track + '"]');
	}

	close(error=null) {
		if(!this._socket)
			return; // already closed!
		let socket = this._socket;
		this._socket = null;
		socket.onmessage = null; // stop reception (can continue after close!)
		socket.close();
		this.onEnd();
		this.onClose(error);
	}
};

