import { MP4Writer } from "../Base/MP4Writer.js";
import { Media } from "../Base/Media.js";
import { ByteRate } from "../Base/ByteRate.js";
import { Util } from "../Base/Util.js";

// Firefox needs 2 sec of bufferization to avoid artefact on audio rendering
const DEFAULT_BUFFER_TIME_MS = navigator.userAgent.toLowerCase().indexOf('firefox') > -1 ? 2000 : 1000;

const MAX_BUFFER_SIZE_SECONDS = 10; // maximum buffer time to keep
export class Player {
  onBegin() {}
  onProperties(properties) {}
  onEnd() {}
  onClose(error = null) {}

  get byteRate() { return this._byteRate.value(); }
  get properties() { return isNaN(this._firstTimestamp) ? null : this._properties; }
  get closed() { return !this._inputDataSource; }

  constructor(videoEl, source, setVideoSrc = true) {
    if (!videoEl)
      throw new Error('Video element argument required');
    this._videoEl = videoEl;
    if(!source)
      throw new Error("Player source argument required");
    this._mediaSource = new MediaSource();
    this._mediaSource.addEventListener('sourceopen', this._onMediaSourceEvent.bind(this));
    this._mediaSource.addEventListener('sourceclose', this._onMediaSourceEvent.bind(this));
    this._mediaSource.addEventListener('sourceended', this._onMediaSourceEvent.bind(this));

    this._gotSourceOpenEvent = false;
    this._mediaSourceBuffer = null;
    this._mseBufferLimitSeconds = MAX_BUFFER_SIZE_SECONDS;
    this._textTrack = null;

    this._inputDataSource = source;
    this._properties = null;
    this._firstTimestamp = NaN;

    this._time
      = this._videoTime
      = this._audioTime = 0;
    this._seekTime = 0;

    this._mp4Fragments = [];
    this._byteRate = new ByteRate();

    this._mp4Writer = new MP4Writer(!Number.isFinite(source.bufferTime) ? source.bufferTime : DEFAULT_BUFFER_TIME_MS);
    this._mp4Writer._onWrite = this._onMp4Write.bind(this);

    this._inputDataSource.onVideo = this._onInputSourceVideo.bind(this);
    this._inputDataSource.onAudio = this._onInputSourceAudio.bind(this);
    this._inputDataSource.onData = this._onInputSourceData.bind(this);
    this._inputDataSource.onEnd = this._onInputSourceEnd.bind(this);
    this._inputDataSource.onClose = this._onInputSourceClose.bind(this);

    this._isEdge = window.navigator.userAgent.indexOf("Edge") > -1;
    this._setupTextTrackEventHandler();

    if (setVideoSrc)
      this._videoEl.src = this.createMediaSourceBlobUrl();

    this._creationTimePerf = Util.Time();
  }

  /**
   * @returns {string} Creates a new MediaSource object URL
   */
  createMediaSourceBlobUrl() {
    return URL.createObjectURL(this._mediaSource);
  }

  close(error = null) {
    if(this.closed)
      return; // already closed

    this._mp4Writer.flush();

    this._inputDataSource.close(); // call onEnd if need, after mp4Writer.flush to get onEnd after media writing!
    this._inputDataSource = null;

    if(this._mediaSourceBuffer) {
      try { this._mediaSource.removeSourceBuffer(this._mediaSourceBuffer); } catch(_) {}
      this._mediaSourceBuffer = null;
    }

    // release expensive data
    this._dropMp4Data();
    if (this._mp4Writer)
      this._mp4Writer.onWrite = null;
    this._mp4Writer = null;
    this._mediaSource = null;
    this._properties = null;
    this._mp4Fragments = null;

    // MediaElement.error is more readable/precise
    const videoErr = this._videoEl.error;
    if(videoErr) {
      if(videoErr.message) // on safari it can have no message but just a code
        error = videoErr.message;
      else switch(videoErr.code) {
        case MediaError.MEDIA_ERR_DECODE:
          error += " (media decoding error, try to update your web browser)";
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          error += " (media networking error)";
          break;
        case MediaError.MEDIA_ERR_ABORTED:
          error += " (media aborted)";
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          error += " (media not supported)";
          break;
        default:
          error += " (media unknown error)";
      }
    }
    // onClose
    this.onClose && this.onClose(error);
  }

  /* To test Adaptive bitrate setup at least 2 sources from the same video and with different bitrates in MonaTiny.ini.
    The sources must be synchronized.
   */
  switchSource(newSource) {

    this._switchConfigV = this._switchConfigA = null;
    newSource.onVideo = newSource.onAudio = (tag, data) => {
      if (this._inputDataSource) {

        this._inputDataSource.onVideo = (tag, data) => {};
        this._inputDataSource.onAudio = (tag, data) => {};
        this._inputDataSource.onData = (handler, ...params) => {};
        this._inputDataSource.onEnd = () => {};
        this._inputDataSource.onClose = (error) => {};
        this._inputDataSource.close();
        this._inputDataSource = null;
      }

      // Save config packets and wait for the next key frame
      let packetTime = Util.AddDistance32(tag.time, this._seekTime - this._firstTimestamp);
      if (tag.frame == Media.Video.Frame.CONFIG)
        this._switchConfigV = {tag: tag, data: data};
      else if (tag.isConfig)
        this._switchConfigA = {tag: tag, data: data};
      else if (tag.frame == Media.Video.Frame.KEY && packetTime >= this._videoTime) {

        // Next key frame found! we start playing the new source
        this._inputDataSource = newSource;
        this._inputDataSource.onVideo = this._onVideo;
        this._inputDataSource.onAudio = this._onAudio;
        this._inputDataSource.onData = this._onData;
        this._inputDataSource.onEnd = this._onEnd;
        this._inputDataSource.onClose = this._onClose;

        // Forward the config packets and the key frame packet
        if (this._switchConfigV)
          this._inputDataSource.onVideo(this._switchConfigV.tag, this._switchConfigV.data);
        if (this._switchConfigA)
          this._inputDataSource.onAudio(this._switchConfigA.tag, this._switchConfigA.data);
        this._inputDataSource.onVideo(tag, data);
      } else
        console.warn("Ignored packet ", tag.frame ? "VIDEO" : "AUDIO", " time : ", packetTime, " ; ", tag.frame? tag.frame : tag.isConfig);
    }
  }

  _handlePropertiesData(properties) {
    if(JSON.stringify(properties) === JSON.stringify(this._properties))
      return;

    if (!this._properties) {
      this.onProperties && this.onProperties(properties);
    }
    this._properties = properties;

    this._createNativeTextTracks(properties);
  }

  _createNativeTextTracks(properties) {
    if(this._isEdge)
      return;

    // mark existing tracks
    let textTracks = this._videoEl.textTracks;
    for(let i=0; i < textTracks.length; ++i)
      textTracks[i].track = 0;
    // create text tracks!
    for(let name in properties) {
      let track = Number(name);
      if(!track)
        return;
      let lang = properties[name].textLang;
      if(!lang)
        return;
      // search if exists already!
      let i;
      for(i=0; i < textTracks.length; ++i) {
        if(textTracks[i].language == lang) {
          textTracks[i].track = track;
          if(textTracks[i].mode=="disabled")
            textTracks[i].mode = "hidden";
          break;
        }
      }
      if(i==textTracks.length) // create!
        this._videoEl.addTextTrack("captions", lang, lang).track = track;
    };
    // disable useless tracks
    for(let i=0; i < textTracks.length; ++i) {
      if(!textTracks[i].track)
        textTracks[i].mode = "disabled";
    }
  }

  _processAvPayloadTag(tag) {
    if(!tag.isConfig && tag.frame !== Media.Video.Frame.CONFIG) {
      if(isNaN(this._firstTimestamp)) {

        const timeToFirstPayloadMs = Util.Time() - this._creationTimePerf;
        console.log('Took', timeToFirstPayloadMs, 'millis until first raw AV-payload (before remuxing)');

        this._firstTimestamp = tag.time;
        this.onBegin && this.onBegin();

        // FIXME: should not be here
        if(this._videoEl.autoplay && this._videoEl.muted)
          this._video.play(); // fix a firefox issue with autoplay not working!


      }
      this._time = tag.time = Util.AddDistance32(tag.time, this._seekTime - this._firstTimestamp);
      if (tag.frame)
        this._videoTime = this._time;
      else
        this._audioTime = this._time;
    } else
      tag.time = tag.isConfig? this._audioTime : this._videoTime; // config tag must be sync with the SAME track time
    // console.log(tag.frame ? "VIDEO" : "AUDIO", tag.isConfig || tag.frame || false, tag.time);
    return tag;
  }

  _onMediaSourceEvent(event) {
    console.log('MediaSource event type:', event.type);

    switch(event.type) {
    case 'sourceopen':
      const timeToMseOpen = Util.Time() - this._creationTimePerf;
      console.log('Took', timeToMseOpen, 'millis until MediaSource opened');
      if (this._gotSourceOpenEvent) {
        break;
      }
      this._gotSourceOpenEvent = true;
      // if codec data not there yet, it should get created
      // as we get mp4 data written out. we will then create the SourceBuffer there (see _onMp4Write).
      if (this._mp4Writer.codecs) {
        this._createMediaSourceBuffer();
      }
      break;
    case 'sourceclose':
      this._dropMp4Data();
      break;
    }
  }

  /**
   *
   * @param {Uint8Array} packet
   */
  _onMp4Write(packet) {
    if(this._mediaSource.readyState !== "open") {
      console.warn('onWrite: MediaSource is not ready (open), closing playback');
      this.close(this._mediaSource.readyState);
      return false; // returning false makes sure we dont get called again
    }

    //console.log('MP4onWrite:', packet);

    // console.log(this._time-(video.currentTime*1000), this._time, video.currentTime*1000);
    this._mp4Fragments.push(packet);

    // if no SourceBuffer exists yet, as we have codec data, create SourceBuffer
    // but check that MediaSource is already open as this here can also happen before that in principle.
    if (!this._mediaSourceBuffer && this._mp4Writer.codecs && this._mediaSource.readyState === 'open') {
      this._createMediaSourceBuffer();
    }

    this._consumeMp4Data();

    return true;
  }

  _createMediaSourceBuffer() {
    if (!this._mp4Writer.codecs) {
      throw new Error('Need codecs info to create SourceBuffer');
    }
    const timeToMp4Codecs = Util.Time() - this._creationTimePerf;
    console.log('Took', timeToMp4Codecs, 'millis until obtained MP4 codecs (to create SourceBuffer)');
    // 'video/mp4; codecs="avc1.640028, mp4a.40.2"'
    let type = 'video/mp4; codecs="' + this._mp4Writer.codecs + '"';
    console.log("creating MSE SourceBuffer with mimeType:", type);
    try { // try catch because can throw exception without assigned a video.error reason!
      this._mediaSource.duration = 0;
      this._mediaSourceBuffer = this._mediaSource.addSourceBuffer(type);
      this._mediaSourceBuffer.mode = "sequence"; // only allow append packets in order
    } catch (err) {
      this.close("Update or change your browser, no support to " + type);
      return false;
    }
    this._mediaSourceBuffer.addEventListener('updateend', this._onSourceBufferUpdateDone.bind(this));
  }

  _onSourceBufferUpdateDone() {

    if (!this._updateFirstMp4) {
      this._updateFirstMp4 = true;
      const timeToBuffer = Util.Time() - this._creationTimePerf;
      console.log('Took', timeToBuffer, 'millis until first updated event from SourceBuffer (MP4 appending completed)');
    }

    this._consumeMp4Data();
  }

  _dropMp4Data() {
    this._mp4Fragments.length = 0;
  }

  _consumeMp4Data() {
    if (!this._mediaSourceBuffer) {
      console.warn('Attempt to consume MP4-data without SourceBuffer existing to append it');
      return;
    }

    // Cleanup first, keep only this._bufferLimit seconds to avoid buffer overload
    // If we would call this after the append we risk the buffer will probably
    // be in "updating" state and thus we could never prune it.

    if (!this._mediaSourceBuffer.updating && this._mediaSourceBuffer.buffered.length > 0) {
      let start = this._mediaSourceBuffer.buffered.start(0);
      let end = this._mediaSourceBuffer.buffered.end(0);
      // check if above limit
      if ((end - start) > this._mseBufferLimitSeconds) {

        let newStart = end - this._mseBufferLimitSeconds;
        if (newStart + this._mseBufferLimitSeconds / 2 >= this._videoEl.currentTime) {
          newStart = this._videoEl.currentTime - this._mseBufferLimitSeconds / 2;
        }

        // FIXME: doesn't work atm, interrupts playback
        /*
        console.log('video playback time:', this._videoEl.currentTime,'pruning MSE buffer to begin at', newStart)
        this._mediaSourceBuffer.remove(newStart, end);
        */
      }
    }

    if (!this._appendFirstMp4) {
      this._appendFirstMp4 = true;
      const timeToBuffer = Util.Time() - this._creationTimePerf;
      console.log('Took', timeToBuffer, 'millis until appending first MP4 data to MSE buffer');
    }

    while(!this._mediaSourceBuffer.updating && this._mp4Fragments.length) {
      try { // try catch because can throw exception without assigned a video.error reason!
        //console.log('appending mp4 fragment to SourceBuffer')
        this._mediaSourceBuffer.appendBuffer(this._mp4Fragments.shift());
      } catch (e) {
        this._dropMp4Data(); // to avoid double flush on close!
        this.close("MSE Player Error : " + (e.message || e.toString()));
        return;
      }
    }
  }

  _onInputSourceAudio(tag, data) {
    this._byteRate.addBytes(data.byteLength);

    this._mp4Writer.writeAudio(this._processAvPayloadTag(tag), data);
  }

  _onInputSourceVideo(tag, data) {
    this._byteRate.addBytes(data.byteLength);

    this._mp4Writer.writeVideo(this._processAvPayloadTag(tag), data);
  }

  _onInputSourceData(handler, ...params) {
    switch(handler) {
    case "@text":
      let text = params[0];
      if(this._textTrack) {
        let time = this._time/1000;
        this._textTrack.addCue(new VTTCue(time, time+Math.min(Math.max(text.length / 20, 3), 10), text));
      }
      break;
    case "@properties":
      this._handlePropertiesData(params[0]);
      break;
    default:
      console.log(handler, JSON.stringify(params, null, 4));
    }
  }

  _onInputSourceEnd() {
    if(isNaN(this._firstTimestamp))
      return;
    this._firstTimestamp = NaN;
    this._seekTime = this._time;
    this.onEnd && this.onEnd();
  }

  _onInputSourceClose(error) {
    this.close(error);
  }

  _setupTextTrackEventHandler() {
    if(this._isEdge)
      return;

    this._videoEl.textTracks.addEventListener("change", () => {
      this._onNativeTextTrackChange();
    });
  }

  _onNativeTextTrackChange() {
    const videoEl = this._videoEl;
    for(let i=0; i < videoEl.textTracks.length; ++i) {
      let textTrack = videoEl.textTracks[i];
      if(textTrack.mode !== "showing") {
        continue;
      }
      if(this._textTrack === textTrack)
        return;
      // new text-track found
      this._textTrack = textTrack;
      this._input.setDataTrack(this._textTrack.track);
      return;
    }
    // no text-track was ever set
    if(!this._textTrack)
      return;
    // we had an event (would have returned before),
    // but no "showing" text-track was set, detach the old one
    this._input.setDataTrack(0);
    this._textTrack = null;
  }

};

