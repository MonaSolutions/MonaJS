/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

// accurate timers, use Timer!
let _perf = performance;
function Time() { return Math.round(_perf.now()); }
function LowerBound(array, element, comparator=null) {
    if(!comparator)
        comparator = array.comparator || ((a,b) => a-b);
    let result = 0;
    let count = array.length; // Not n - 1
    let match = false;
    while (result < count) {
        let mid = Math.floor((result + count) / 2);
        let delta = comparator(element, array[mid]);
        if(delta<=0) {
            count = mid;
            if(!delta)
                match = true;
        } else
            result = mid + 1;
    }
    if(match) {
        // search on the right if there is an element equals to elements
        match = result;
        do {
            if(element==array[match])
                return match;
        } while(++match<array.length && !comparator(element, array[match]));
    }
    return result;
}

class Timers extends Array {
    get comparator() { return (a, b) => a.id - b.id; }
    constructor(timeout=undefined) {
        super();
        this.timeout = timeout;
    }
}

let _raising;
let _timeouts = new Array(); // Internal array of array of timers, grouped by timeout delay
_timeouts.comparator = (a, b) => a.timeout - b.timeout;
_timeouts.add = function(timer, timeout = (Time() + timer.interval)) {
    timer.timeout = timeout;
    let index = LowerBound(this, timer);
    let timers = this[index];
    if(!timers || timers.timeout != timeout)
        this.splice(index, 0, timers = new Timers(timeout));
    timers.splice(index = LowerBound(timers, timer), 0, timer);
    return index;
}
_timeouts.remove = function(timer) {
    let index = LowerBound(this, timer);
    let timers = this[index];
    if(!timers || timers.timeout != timer.timeout)
        return;
    let indexTimer = LowerBound(timers, timer);
    if(indexTimer<timers.length && timers[indexTimer].id == timer.id) {
        if (timers.length>1)
            timers.splice(indexTimer, 1);
        else
            this.splice(index, 1);
    }
}

function raise() {
    if(!_timeouts.length)
        return;
    for(;;) {
        if (!_timeouts.length)
            return;
        let now = Time();
        let waiting = _timeouts[0].timeout - now;
        if(waiting>0)
            return _raising = setTimeout(raise, waiting);
        for(let timer of _timeouts.shift()) {
            let delay = waiting;
            do {
                postMessage([timer.id, -delay]);
                timer.timeout += timer.interval;
                delay = timer.timeout - now;
            } while(delay<=0);
            if (!timer.callOnce) // loop timer
                _timeouts.add(timer, timer.timeout);
        }
    }
}

let _timers = new Timers(); // Global Array of user timers
onmessage = function(e) {
    let timer = {id: e.data[0], interval: Math.max(e.data[1], 0), callOnce: e.data[2]};
    let index = LowerBound(_timers, timer);
    let found = _timers[index];
    if(!found || found.id != timer.id) {
        if(timer.interval)
            _timers.splice(index, 0, timer);  
        found = null;
    } else if(!timer.interval) // remove
        _timers.splice(index, 1);
    if(timer.interval == (found ? found.interval : 0)) {
        console.warn("Useless clock register with same timeout");
        return;
    }
    // remove from current timeouts!
    if(found) 
        _timeouts.remove(found);
    if(!timer.interval)
        return;
    // add in current timeouts!
    if(_timeouts.add(timer))
        return;
    // update raising!
    clearTimeout(_raising);
    raise();
}
