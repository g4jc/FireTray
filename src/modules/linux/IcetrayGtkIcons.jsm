/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

var EXPORTED_SYMBOLS = [ "icetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://icetray/commons.js"); // first for Handler.app !
Cu.import("resource://icetray/ctypes/linux/"+icetray.Handler.app.widgetTk+"/gtk.jsm");
icetray.Handler.subscribeLibsForClosing([gtk]);

if ("undefined" == typeof(icetray.StatusIcon))
  log.error("This module MUST be imported from/after StatusIcon !");

let log = icetray.Logging.getLogger("icetray.GtkIcons");


icetray.GtkIcons = {
  initialized: false,

  GTK_THEME_ICON_PATH: null,

  init: function() {
    try {
      if (this.initialized) return true;

      this.appendSearchPath();
      this.initialized = true;
      return true;
    } catch (x) {
      log.error(x);
      return false;
    }
  },

  shutdown: function() {
    // FIXME: XXX destroy icon here
    this.initialized = false;
  },

  appendSearchPath: function() {
    log.debug(icetray.StatusIcon.THEME_ICON_PATH);
    let gtkIconTheme = gtk.gtk_icon_theme_get_default();
    log.debug("gtkIconTheme="+gtkIconTheme);
    gtk.gtk_icon_theme_append_search_path(gtkIconTheme, this.GTK_THEME_ICON_PATH);

    if (log.level <= icetray.Logging.LogMod.Level.Debug) {
      Cu.import("resource://icetray/ctypes/linux/glib.jsm");
      Cu.import("resource://icetray/ctypes/linux/gobject.jsm");
      icetray.Handler.subscribeLibsForClosing([glib, gobject]);
      let path = new gobject.gchar.ptr.ptr;
      let n_elements = new gobject.gint;
      gtk.gtk_icon_theme_get_search_path(gtkIconTheme, path.address(), n_elements.address());
      log.debug("n_elements="+n_elements+" path="+path);
      let pathIt = path;
      for (let i=0, len=n_elements.value; i<len || pathIt.isNull(); ++i) {
        log.debug("path["+i+"]="+pathIt.contents.readString());
        pathIt = pathIt.increment();
      }
      log.debug("path="+path+" pathIt="+pathIt);
      glib.g_strfreev(path);
    }
  }

};
