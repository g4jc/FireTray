/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
"use strict";

Components.utils.import("resource://icetray/commons.js");
Components.utils.import("resource://icetray/IcetrayHandler.jsm");

if ("undefined" == typeof(Cc)) var Cc = Components.classes;
if ("undefined" == typeof(Ci)) var Ci = Components.interfaces;
if ("undefined" == typeof(Cu)) var Cu = Components.utils;

// can't use 'log': don't pollute global (chrome) namespace
let icetray_log = icetray.Logging.getLogger("icetray.Chrome");

// https://groups.google.com/group/mozilla.dev.extensions/browse_thread/thread/e89e9c2a834ff2b6#
var icetrayChrome = { // each new window gets a new icetrayChrome !

  strings: null,
  winId: null,

  onLoad: function(win) {
    this.strings = document.getElementById("icetray-strings"); // chrome-specific

    icetray_log.debug("Handler initialized: "+icetray.Handler.initialized);
    let init = icetray.Handler.initialized || icetray.Handler.init();

    icetray_log.debug("ONLOAD");
    this.winId = icetray.Handler.registerWindow(win);

    win.addEventListener('close', icetrayChrome.onClose, true);
    this.hijackTitlebarButtons();

    icetray_log.debug('Icetray LOADED: ' + init);
    return true;
  },

  /* NOTE: don't do icetray.Handler.initialized=false here, otherwise after a
   window close, a new window will create a new handler (and hence, a new tray
   icon) */
  onQuit: function(win) {
    win.removeEventListener('close', icetrayChrome.onClose, true);
    icetray.Handler.unregisterWindow(win);
    icetray_log.debug("windowsCount="+icetray.Handler.windowsCount+", visibleWindowsCount="+icetray.Handler.visibleWindowsCount);
    icetray_log.debug('Icetray UNLOADED !');
  },

  /* until we find a fix (TODO), we need to set browser.tabs.warnOnClose=false
   to prevent the popup when closing a window with multiple tabs and when
   hides_on_close is set (we are not actually closing the tabs!). There is no
   use trying to set warnOnClose=false temporarily in onClose, since onClose is
   called *after* the popup */
  onClose: function(event) {
    icetray_log.debug('Icetray CLOSE');
    let hides_on_close = icetray.Utils.prefService.getBoolPref('hides_on_close');
    icetray_log.debug('hides_on_close: '+hides_on_close);
    if (!hides_on_close) return false;

    let hides_single_window = icetray.Utils.prefService.getBoolPref('hides_single_window');
    let hides_last_only = icetray.Utils.prefService.getBoolPref('hides_last_only');
    icetray_log.debug('hides_single_window='+hides_single_window+', windowsCount='+icetray.Handler.windowsCount);
    if (hides_last_only && (icetray.Handler.windowsCount > 1)) return true;

    if (hides_single_window)
      icetray.Handler.hideWindow(icetrayChrome.winId);
    else
      icetray.Handler.hideAllWindows();

    if (event) event.preventDefault();
    return true;
  },

  /*
   * Minimize/Restore/Close buttons can be overlayed by titlebar (fake) buttons
   * which do not fire the events that we rely on (see Bug 827880). This is why
   * we override the fake buttons' default actions.
   */
  hijackTitlebarButtons: function() {
    Object.keys(this.titlebarDispatch).forEach(function(id) {
      if (icetrayChrome.replaceCommand(id, this.titlebarDispatch[id])) {
        icetray_log.debug('replaced command='+id);
      }
    }, this);
  },

  titlebarDispatch: {
    "titlebar-min": function() {
      return icetray.Handler.onMinimize(icetrayChrome.winId);
    },
    "titlebar-close": function() {
      return icetrayChrome.onClose(null);
    }
  },

  replaceCommand: function(eltId, gotHidden) {
    let elt = document.getElementById(eltId);
    if (!elt) {
      icetray_log.debug("Element '"+eltId+"' not found. Command not replaced.");
      return false;
    }

    let prevent = null;
    if (elt.command) {
      prevent = { event: "click", func: function(e){e.preventDefault();} };
    } else if (elt.getAttribute("oncommand")) {
      prevent = { event: "command", func: function(e){e.stopPropagation();} };
    } else {
      icetray_log.warn('Could not replace oncommand on '+eltId);
      return false;
    }

    let callback = function(event) {
      if (event.target.id === eltId) {
        icetray_log.debug(prevent.event +' on '+eltId);
        if (gotHidden())
          prevent.func(event);
      }
    };
    /* We put listeners on the "titlebar" parent node, because:
     - we can hardly short-circuit command/oncommand (probably because they are
       registered first)
     - we'd have otherwise to alter "oncommand"/"command" attribute and use
       Function(), which do not pass review nowadays. */
    elt.parentNode.addEventListener(prevent.event, callback, true);

    return true;
  }

};

// should be sufficient for a delayed Startup (no need for window.setTimeout())
// https://developer.mozilla.org/en/XUL_School/JavaScript_Object_Management.html
// https://developer.mozilla.org/en/Extensions/Performance_best_practices_in_extensions#Removing_Event_Listeners
window.addEventListener(
  'load', function removeOnloadListener(e) {
    removeEventListener('load', removeOnloadListener, true);
    icetrayChrome.onLoad(this); },
  false);
window.addEventListener(
  'unload', function removeOnUnloadListener(e) {
    removeEventListener('unload', removeOnUnloadListener, true);
    icetrayChrome.onQuit(this); },
  false);
