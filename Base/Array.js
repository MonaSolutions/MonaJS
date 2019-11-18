/* 
This file is a part of MonaSolutions Copyright 2019
mathieu.poux[a]gmail.com
jammetthomas[a]gmail.com

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/. 

*/

Array.ToString = function(array, toString = (elt) => elt.toString()) {
	let result = "";
	for(let elt of array) {
		if(result.length)
			result += ',';
		result += toString(elt);
	}
	return result;
}

Array.Shuffle = function(array) {
	let j, x, i;
	for (i = array.length - 1; i > 0; i--) {
		j = Math.floor(Math.random() * (i + 1));
		x = array[i];
		array[i] = array[j];
		array[j] = x;
	}
	return array;
}

Array.Equal = function(a, b, compare = (a, b, i) => a[i]===b[i]) {
	if(!a)
		return !b;
	if(!b)
		return !a;
	if (a.length != b.length)
		return false;
	for (let i = 0 ; i != a.length ; ++i) {
		if (!compare(a, b, i))
			return false;
	}
	return true;
}

Array.LowerBound = function(array, element, comparator=null) {
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

Array.Insert = function(array, element, comparator=null) {
	let index = this.LowerBound(array, element, comparator);
	array.splice(index, 0, element);
	return index;
}

Array.Remove = function(array,  element, comparator=null) {
	let index = this.LowerBound(array, element, comparator);
	if(element!=array[index])
		return -1;
	array.splice(index, 1);
	return index;
}

/**
 * Move element in a array in a optimized way, is signifiantly more faster rather array.splice(to, 0, ...array.splice(from, 1))
 * when number of elements are inferior to 100?
 * @param {*} array 
 * @param {*} from 
 * @param {*} to 
 */
Array.Move = function(array, from, to) {
	if( to == from )
		return array;
	let element = array[from];                         
	let step = to < from ? -1 : 1;
	for(let i = from; i != to; i += step)
		array[i] = array[i + step];
	array[to] = element;
	return array;
}
