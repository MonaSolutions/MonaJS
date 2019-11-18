var displayError = function(text) {
    var div = document.getElementById("_errorDisplay");
    if (!div) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(text));
        div.style.width = "100%";
        div.style.height = "100%";
        div.style.color = "#fff";
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.justifyContent = "center";
        div.style.position = "fixed";
        div.style.left = 0;
        div.style.top = 0;
        div.style.backgroundColor = "#000";
        div.style.zIndex = 10000;
        document.body.appendChild(div);
    } else
        div.childNodes[0].nodeValue = text;
}

var displayWarn = function(text) {
    var div = document.getElementById("_warnDisplay");
    if (!div) {
        div = document.createElement("div");
        div.id = "_warnDisplay";
        div.appendChild(document.createTextNode(text));
        div.style.height = "35px";
        div.style.color = "#fff";
        div.style.position = "fixed";
        div.style.bottom = 0;
        div.style.right = 0;
        div.style.backgroundColor = "background-color: rgba(0, 0, 0, 0.6)";
        div.style.zIndex = 200;
        document.body.appendChild(div);
    } else
        div.childNodes[0].nodeValue = text;
}

var checkES6Support = function() {
    // supports ES6?
    try {
        new Function("(a = 0) => a");
    } catch (err) {
        displayError("Your browser does not support ES6, try to update or change your browser to see this stream.");
        return false;
    }
    
    const script = document.createElement('script');
    if (!('noModule' in script)) {
        displayError("Your browser does not support ES6, try to update or change your browser to see this stream.");
        return false;
    }
    return true;
}

var checkChromeVersion = function() {
    let chromeVer, uAgent=navigator.userAgent;
    if ((chromeVer = uAgent.indexOf("Chrome"))!=-1) {
        chromeVer = uAgent.substring(chromeVer+7).split(" ")[0].substring(0, 2);
        if (parseInt(chromeVer) < 72)
            displayWarn("If you get execution latency try chrome version >= 72 rather " + chromeVer + " (issue with ArraySplice)");
    }
}

var checkMSESupport = function() {
    // supports MSE?
    try {
        new MediaSource();
    } catch (err) {
        displayError("Your browser does not support MSE (MediaSource), try to update or change your browser to see this stream.");
        return false;
    }
}

// mandatory for MonaJS!
checkES6Support();

// Current chrome version have an issue in the Array.split() function
checkChromeVersion();

// iOS for example doesn't support MSE
checkMSESupport();
