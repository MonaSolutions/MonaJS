let _id = 0;
let _freeIds = new Array();
let _methods = new Map();
let _TimersWorker = new Worker("/Base/Timers.js"); // FIXME: needs to be configurable (or built-in using WebPack)
_TimersWorker.onmessage = (e) => {
    let method = _methods.get(e.data[0]);
    if(method)
        method(e.data[1]);
}

export let Timer = {
    Set(method, interval, callOnce) {
        let id = _freeIds.length ? _freeIds.pop() : ++_id;
        _methods.set(id, method);
        _TimersWorker.postMessage([id, Math.max(Math.round(interval), 1), callOnce]);
        return id;
    },
    Clear(id) {
        if(!id || !_methods.delete(id))
            return;
        _TimersWorker.postMessage([id, 0]);
        _freeIds.push(id);
    }
}