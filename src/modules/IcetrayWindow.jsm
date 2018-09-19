/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
// https://developer.mozilla.org/en/Code_snippets/Preferences

var EXPORTED_SYMBOLS = [ "IcetrayWindow" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://icetray/commons.js");

let log = icetray.Logging.getLogger("icetray.IcetrayWindow");

if ("undefined" == typeof(icetray.Handler))
  log.error("This module MUST be imported from/after IcetrayHandler !");

function IcetrayWindow () {}
IcetrayWindow.prototype = {

  getRegisteredWinIdFromChromeWindow: function(win) {
    for (let wid in icetray.Handler.windows)
      if (icetray.Handler.windows[wid].chromeWin === win) return wid;
    log.error("unknown window while lookup");
    return null;
  },

  getWindowTitle: function(wid) {
    let title = icetray.Handler.windows[wid].baseWin.title;
    log.debug("|baseWin.title="+title+"|");
    // FIXME: we should be able to compute the base title from the XUL window
    // attributes.
    const kTailRe = " (-|\u2014) ((Mozilla )?"+icetray.Handler.app.name+"|Nightly)";
    let tailIndex = title.search(kTailRe);
    if (tailIndex !== -1)
      return title.substring(0, tailIndex);
    else
      return title;
  }

};
