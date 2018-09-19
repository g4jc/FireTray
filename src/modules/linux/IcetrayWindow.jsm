/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

/* GdkWindow and GtkWindow are totally different things. A GtkWindow is a
 "standalone" window. A GdkWindow is just a region on the screen that can
 capture events and has certain attributes (such as a cursor, and a coordinate
 system). Basically a GdkWindow is an X window, in the Xlib sense, and
 GtkWindow is a widget used for a particular UI effect.
 (http://mail.gnome.org/archives/gtk-app-devel-list/1999-January/msg00138.html) */

var EXPORTED_SYMBOLS = [ "icetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://icetray/commons.js"); // first for Handler.app !
Cu.import("resource://icetray/ctypes/ctypesMap.jsm");
Cu.import("resource://icetray/ctypes/linux/gobject.jsm");
Cu.import("resource://icetray/ctypes/linux/"+icetray.Handler.app.widgetTk+"/gdk.jsm");
Cu.import("resource://icetray/ctypes/linux/"+icetray.Handler.app.widgetTk+"/gtk.jsm");
Cu.import("resource://icetray/ctypes/linux/libc.jsm");
Cu.import("resource://icetray/ctypes/linux/x11.jsm");
Cu.import("resource://icetray/IcetrayWindow.jsm");
icetray.Handler.subscribeLibsForClosing([gobject, gdk, gtk, libc, x11, glib]);

let log = icetray.Logging.getLogger("icetray.Window");

if ("undefined" == typeof(icetray.Handler))
  log.error("This module MUST be imported from/after IcetrayHandler !");

const Services2 = {};
XPCOMUtils.defineLazyServiceGetter(
  Services2,
  "uuid",
  "@mozilla.org/uuid-generator;1",
  "nsIUUIDGenerator"
);

const ICETRAY_XWINDOW_HIDDEN    = 1 << 0; // when minimized also
const ICETRAY_XWINDOW_MAXIMIZED = 1 << 1;

/**
 * custum type used to pass data in to and out of findGtkWindowByTitleCb
 */
var _find_data_t = ctypes.StructType("_find_data_t", [
  { inTitle: ctypes.char.ptr },
  { outWindow: gtk.GtkWindow.ptr }
]);

// NOTE: storing ctypes pointers into a JS object doesn't work: pointers are
// "evolving" after a while (maybe due to back and forth conversion). So we
// need to store them into a real ctypes array !
icetray.Handler.gtkWindows              = new ctypesMap(gtk.GtkWindow.ptr);
icetray.Handler.gdkWindows              = new ctypesMap(gdk.GdkWindow.ptr);
icetray.Handler.gtkPopupMenuWindowItems = new ctypesMap(gtk.GtkImageMenuItem.ptr);


icetray.Window = new IcetrayWindow();
icetray.Window.signals = {'focus-in': {callback: {}, handler: {}}};

icetray.Window.init = function() {
  let gtkVersionCheck = gtk.gtk_check_version(
    gtk.ICETRAY_REQUIRED_GTK_MAJOR_VERSION,
    gtk.ICETRAY_REQUIRED_GTK_MINOR_VERSION,
    gtk.ICETRAY_REQUIRED_GTK_MICRO_VERSION
  );
  if (!gtkVersionCheck.isNull())
    log.error("gtk_check_version="+gtkVersionCheck.readString());

  if (icetray.Handler.isChatEnabled()) {
    Cu.import("resource://icetray/linux/IcetrayChat.jsm");
    Cu.import("resource://icetray/linux/IcetrayChatStatusIcon.jsm");
  }

  this.initialized = true;
};

icetray.Window.shutdown = function() {
  this.initialized = false;
};

/**
 * Iterate over all Gtk toplevel windows to find a window. We rely on
 * Service.wm to watch windows correctly: we should find only one window.
 *
 * @author Nils Maier (stolen from MiniTrayR), himself inspired by Windows docs
 * @param window nsIDOMWindow from Services.wm
 * @return a gtk.GtkWindow.ptr
 */
icetray.Window.getGtkWindowFromChromeWindow = function(window) {
  let baseWindow = window
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIWebNavigation)
        .QueryInterface(Ci.nsIBaseWindow);

  // Tag the base window
  let oldTitle = baseWindow.title;
  log.debug("oldTitle="+oldTitle);
  baseWindow.title = Services2.uuid.generateUUID().toString();

  try {
    // Search the window by the *temporary* title
    let widgets = gtk.gtk_window_list_toplevels();
    let that = this;
    let findGtkWindowByTitleCb = gobject.GFunc_t(that._findGtkWindowByTitle); // void return, no sentinel
    var userData = new _find_data_t(
      ctypes.char.array()(baseWindow.title),
      null
    ).address();
    log.debug("userData="+userData);
    gobject.g_list_foreach(widgets, findGtkWindowByTitleCb, userData);
    gobject.g_list_free(widgets);

    if (userData.contents.outWindow.isNull())
      throw new Error("Window not found!");

    log.debug("found window: "+userData.contents.outWindow);
  } catch (x) {
    log.error(x);
  } finally {
    // Restore
    baseWindow.title = oldTitle;
  }

  return userData.contents.outWindow;
};

/**
 * compares a GtkWindow's title with a string passed in userData
 * @param gtkWidget: GtkWidget from gtk_window_list_toplevels()
 * @param userData: _find_data_t
 */
icetray.Window._findGtkWindowByTitle = function(gtkWidget, userData) {
  let data = ctypes.cast(userData, _find_data_t.ptr);
  let inTitle = data.contents.inTitle;

  let gtkWin = ctypes.cast(gtkWidget, gtk.GtkWindow.ptr);
  let winTitle = gtk.gtk_window_get_title(gtkWin);

  if (!winTitle.isNull()) {
    log.debug(inTitle+" = "+winTitle);
    if (libc.strcmp(inTitle, winTitle) == 0)
      data.contents.outWindow = gtkWin;
  }
};

icetray.Window.getGdkWindowFromGtkWindow = function(gtkWin) {
  try {
    let gtkWid = ctypes.cast(gtkWin, gtk.GtkWidget.ptr);
    return gtk.gtk_widget_get_window(gtkWid);
  } catch (x) {
    log.error(x);
  }
  return null;
};

if (icetray.Handler.app.widgetTk == "gtk2") {

  icetray.Window.getXIDFromGdkWindow = function(gdkWin) {
    return gdk.gdk_x11_drawable_get_xid(ctypes.cast(gdkWin, gdk.GdkDrawable.ptr));
  };

  icetray.Window.getXIDFromGtkWidget = function(gtkWid) {
    let gdkWin = gtk.gtk_widget_get_window(gtkWid);
    return gdk.gdk_x11_drawable_get_xid(ctypes.cast(gdkWin, gdk.GdkDrawable.ptr));
  };

}
else if (icetray.Handler.app.widgetTk == "gtk3") {

  icetray.Window.getXIDFromGdkWindow = function(gdkWin) {
    return gdk.gdk_x11_window_get_xid(gdkWin);
  };

  icetray.Window.getXIDFromGtkWidget = function(gtkWid) {
    let gdkWin = gtk.gtk_widget_get_window(gtkWid);
    return gdk.gdk_x11_window_get_xid(gdkWin);
  };

}
else {
  log.error("Unhandled widgetTk: "+icetray.Handler.app.widgetTk);
}

icetray.Window.addrPointedByInHex = function(ptr) {
  return "0x"+ctypes.cast(ptr, ctypes.uintptr_t.ptr).contents.toString(16);
};

icetray.Window.getGdkWindowFromNativeHandle = function(nativeHandle) {
  let gdkw = new gdk.GdkWindow.ptr(ctypes.UInt64(nativeHandle)); // a new pointer to the GdkWindow
  gdkw = gdk.gdk_window_get_toplevel(gdkw);
  log.debug("gdkw="+gdkw+" *gdkw="+this.addrPointedByInHex(gdkw));
  return gdkw;
};

icetray.Window.getGtkWindowFromGdkWindow = function(gdkWin) {
  let gptr = new gobject.gpointer;
  gdk.gdk_window_get_user_data(gdkWin, gptr.address());
  log.debug("gptr="+gptr+" *gptr="+this.addrPointedByInHex(gptr));
  let gtkw = ctypes.cast(gptr, gtk.GtkWindow.ptr);
  log.debug("gtkw="+gtkw+" *gtkw="+this.addrPointedByInHex(gtkw));
  return gtkw;
};

/* consider using getRegisteredWinIdFromChromeWindow() if you only need the XID */
icetray.Window.getWindowsFromChromeWindow = function(win) {
  let baseWin = icetray.Handler.getWindowInterface(win, "nsIBaseWindow");
  let nativeHandle = baseWin.nativeHandle; // Moz' private pointer to the GdkWindow
  log.debug("nativeHandle="+nativeHandle);
  let gtkWin, gdkWin;
  if (nativeHandle) { // Gecko 17+
    gdkWin = icetray.Window.getGdkWindowFromNativeHandle(nativeHandle);
    gtkWin = icetray.Window.getGtkWindowFromGdkWindow(gdkWin);
  } else {
    gtkWin = icetray.Window.getGtkWindowFromChromeWindow(win);
    gdkWin = icetray.Window.getGdkWindowFromGtkWindow(gtkWin);
  }
  let xid = icetray.Window.getXIDFromGdkWindow(gdkWin);
  log.debug("XID="+xid);
  return [baseWin, gtkWin, gdkWin, xid];
};

icetray.Window.unregisterWindowByXID = function(xid) {
  if (!icetray.Handler.windows.hasOwnProperty(xid)) {
    log.error("can't unregister unknown window "+xid);
    return false;
  }

  icetray.Window.detachOnFocusInCallback(xid);
  if (icetray.Handler.isChatEnabled() && icetray.Chat.initialized) {
    icetray.Chat.detachSelectListeners(icetray.Handler.windows[xid].chromeWin);
  }

  if (!delete icetray.Handler.windows[xid])
    throw new DeleteError();
  icetray.Handler.gtkWindows.remove(xid);
  icetray.Handler.gdkWindows.remove(xid);

  icetray.PopupMenu.removeWindowItem(xid);

  log.debug("window "+xid+" unregistered");
  return true;
};

icetray.Window.show = function(xid) {
  log.debug("show xid="+xid);

  // try to restore previous state. TODO: z-order respected ?
  icetray.Window.restorePositionAndSize(xid);
  icetray.Window.restoreStates(xid);

  // better visual effect if visibility set after restorePosition, but some
  // WMs like compiz seem not to honor position setting if window not visible
  icetray.Window.setVisibility(xid, true);

  // after show
  icetray.Window.restoreDesktop(xid);
  if (icetray.Utils.prefService.getBoolPref('show_activates'))
    icetray.Window.activate(xid);

  icetray.PopupMenu.hideWindowItemAndSeparatorMaybe(xid);
  icetray.Handler.showHideIcon();
};

/* FIXME: hiding windows should also hide child windows, like message windows
 in Icedove-UXP */
icetray.Window.hide = function(xid) {
  log.debug("hide");

  icetray.Window.savePositionAndSize(xid);
  icetray.Window.saveStates(xid);
  icetray.Window.saveDesktop(xid);

  icetray.Window.setVisibility(xid, false);

  icetray.PopupMenu.showWindowItem(xid);
  icetray.Handler.showHideIcon();
};

icetray.Window.startupHide = function(xid) {
  log.debug('startupHide: '+xid);

  // also it seems cleaner, baseWin.visibility=false removes the possibility
  // to restore the app by calling it from the command line. Not sure why...
  icetray.Window.setVisibility(xid, false);

  icetray.PopupMenu.showWindowItem(xid);
  icetray.Handler.showHideIcon();
};

icetray.Window.savePositionAndSize = function(xid) {
  let gx = {}, gy = {}, gwidth = {}, gheight = {};
  icetray.Handler.windows[xid].baseWin.getPositionAndSize(gx, gy, gwidth, gheight);
  icetray.Handler.windows[xid].savedX = gx.value;
  icetray.Handler.windows[xid].savedY = gy.value;
  icetray.Handler.windows[xid].savedWidth = gwidth.value;
  icetray.Handler.windows[xid].savedHeight = gheight.value;
  log.debug("save: gx="+gx.value+", gy="+gy.value+", gwidth="+gwidth.value+", gheight="+gheight.value);
};

icetray.Window.restorePositionAndSize = function(xid) {
  if ("undefined" === typeof(icetray.Handler.windows[xid].savedX))
    return; // windows[xid].saved* may not be initialized

  log.debug("restore: x="+icetray.Handler.windows[xid].savedX+", y="+icetray.Handler.windows[xid].savedY+", w="+icetray.Handler.windows[xid].savedWidth+", h="+icetray.Handler.windows[xid].savedHeight);
  icetray.Handler.windows[xid].baseWin.setPositionAndSize(
    icetray.Handler.windows[xid].savedX,
    icetray.Handler.windows[xid].savedY,
    icetray.Handler.windows[xid].savedWidth,
    icetray.Handler.windows[xid].savedHeight,
    false); // repaint

  ['savedX', 'savedX', 'savedWidth', 'savedHeight'].forEach(function(element) {
    delete icetray.Handler.windows[xid][element];
  });
};

icetray.Window.saveStates = function(xid) {
  let winStates = icetray.Window.getXWindowStates(x11.Window(xid));
  icetray.Handler.windows[xid].savedStates = winStates;
  log.debug("save: windowStates="+winStates);
};

// NOTE: fluxbox bug probably: if hidden and restored iconified, then
// switching to desktop de-iconifies it ?!
icetray.Window.restoreStates = function(xid) {
  let winStates = icetray.Handler.windows[xid].savedStates;
  log.debug("restored WindowStates: " + winStates);

  if (winStates & ICETRAY_XWINDOW_HIDDEN) {
    icetray.Handler.windows[xid].chromeWin.minimize();
    log.debug("restored minimized");
  }

  /* we expect the WM to actually show the window *not* minimized once
   restored */
  if (icetray.Utils.prefService.getBoolPref('hides_on_minimize'))
    // help prevent getting iconify event following show()
    icetray.Handler.windows[xid].chromeWin.restore(); // nsIDOMChromeWindow.idl

  if (winStates & ICETRAY_XWINDOW_MAXIMIZED) {
    icetray.Handler.windows[xid].chromeWin.maximize();
    log.debug("restored maximized");
  }

  delete icetray.Handler.windows[xid].savedStates;
};

icetray.Window.saveDesktop = function(xid) {
  if (!icetray.Utils.prefService.getBoolPref('remember_desktop'))
    return;

  let winDesktop = icetray.Window.getXWindowDesktop(x11.Window(xid));
  icetray.Handler.windows[xid].savedDesktop = winDesktop;
  log.debug("save: windowDesktop="+winDesktop);
};

icetray.Window.restoreDesktop = function(xid) {
  if (!icetray.Utils.prefService.getBoolPref('remember_desktop'))
    return;

  let desktopDest = icetray.Handler.windows[xid].savedDesktop;
  if (desktopDest === null || "undefined" === typeof(desktopDest)) return;

  let dataSize = 1;
  let data = ctypes.long(dataSize);
  data[0] = desktopDest;
  this.xSendClientMessgeEvent(xid, x11.current.Atoms._NET_WM_DESKTOP, data, dataSize);

  log.debug("restored to desktop: "+desktopDest);
  delete icetray.Handler.windows[xid].savedDesktop;
};

icetray.Window.getVisibility = function(xid) {
  let gtkWidget = ctypes.cast(icetray.Handler.gtkWindows.get(xid), gtk.GtkWidget.ptr);
  // nsIBaseWin.visibility always true
  return gtk.gtk_widget_get_visible(gtkWidget);
};

icetray.Window.setVisibility = function(xid, visibility) {
  log.debug("setVisibility="+visibility);
  let gtkWidget = ctypes.cast(icetray.Handler.gtkWindows.get(xid), gtk.GtkWidget.ptr);
  if (visibility)
    gtk.gtk_widget_show_all(gtkWidget);
  else
    gtk.gtk_widget_hide(gtkWidget);
};

icetray.Window.xSendClientMessgeEvent = function(xid, atom, data, dataSize) {
  let xev = new x11.XClientMessageEvent;
  xev.type = x11.ClientMessage;
  xev.window = x11.Window(xid);
  xev.message_type = atom;
  xev.format = 32;
  for (let i=0; i<dataSize; ++i)
    xev.data[i] = data[i];

  let rootWin = x11.XDefaultRootWindow(x11.current.Display);
  let propagate = false;
  let mask = ctypes.long(x11.SubstructureNotifyMask|x11.SubstructureRedirectMask);
  // fortunately, it's OK not to cast xev. ctypes.cast to a void_t doesn't work (length pb)
  let status = x11.XSendEvent(x11.current.Display, rootWin, propagate, mask, xev.address());
  // always returns 1 (BadRequest as a coincidence)
};

/**
 * raises window on top and give focus.
 */
icetray.Window.activate = function(xid) {
  // broken in KDE ?
  gtk.gtk_window_present(icetray.Handler.gtkWindows.get(xid));
  log.debug("window raised");
};

icetray.Window.setUrgency = function(xid, urgent) {
  log.debug("setUrgency: "+urgent);
  gtk.gtk_window_set_urgency_hint(icetray.Handler.gtkWindows.get(xid), urgent);
};

/**
 * YOU MUST x11.XFree() THE VARIABLE RETURNED BY THIS FUNCTION
 * @param xwin: a x11.Window
 * @param prop: a x11.Atom
 */
icetray.Window.getXWindowProperties = function(xwin, prop) {
  // infos returned by XGetWindowProperty() - FIXME: should be freed ?
  let actual_type = new x11.Atom;
  let actual_format = new ctypes.int;
  let nitems = new ctypes.unsigned_long;
  let bytes_after = new ctypes.unsigned_long;
  let prop_value = new ctypes.unsigned_char.ptr;

  let bufSize = XATOMS_EWMH_WM_STATES.length*ctypes.unsigned_long.size;
  let offset = 0;
  let res = x11.XGetWindowProperty(
    x11.current.Display, xwin, prop, offset, bufSize, 0, x11.AnyPropertyType,
    actual_type.address(), actual_format.address(), nitems.address(),
    bytes_after.address(), prop_value.address());
  log.debug("XGetWindowProperty res="+res+", actual_type="+actual_type.value+", actual_format="+actual_format.value+", bytes_after="+bytes_after.value+", nitems="+nitems.value);

  if (!icetray.js.strEquals(res, x11.Success)) {
    log.error("XGetWindowProperty failed");
    return [null, null];
  }
  if (icetray.js.strEquals(actual_type.value, x11.None)) {
    log.debug("property not found");
    return [null, null];
  }

  log.debug("prop_value="+prop_value+", size="+prop_value.constructor.size);
  /* If the returned format is 32, the property data will be stored as an
   array of longs (which in a 64-bit application will be 64-bit values
   that are padded in the upper 4 bytes). [man XGetWindowProperty] */
  if (actual_format.value !== 32) {
    log.error("unsupported format: "+actual_format.value);
  }
  log.debug("format OK");
  var props = ctypes.cast(prop_value, ctypes.unsigned_long.array(nitems.value).ptr);
  log.debug("props="+props+", size="+props.constructor.size);

  return [props, nitems];
};

/**
 * check the state of a window by its EWMH window state. This is more
 * accurate than the chromeWin.windowState or the GdkWindowState which are
 * based on WM_STATE. For instance, WM_STATE becomes 'Iconic' on virtual
 * desktop change...
 */
icetray.Window.getXWindowStates = function(xwin) {
  let winStates = 0;

  let [propsFound, nitems] =
        icetray.Window.getXWindowProperties(xwin, x11.current.Atoms._NET_WM_STATE);
  log.debug("propsFound, nitems="+propsFound+", "+nitems);
  if (!propsFound) return 0;

  let maximizedHorz = maximizedVert = false;
  for (let i=0, len=nitems.value; i<len; ++i) {
    log.debug("i: "+propsFound.contents[i]);
    let currentProp = propsFound.contents[i];
    if (icetray.js.strEquals(currentProp, x11.current.Atoms['_NET_WM_STATE_HIDDEN']))
      winStates |= ICETRAY_XWINDOW_HIDDEN;
    else if (icetray.js.strEquals(currentProp, x11.current.Atoms['_NET_WM_STATE_MAXIMIZED_HORZ']))
      maximizedHorz = true;
    else if (icetray.js.strEquals(currentProp, x11.current.Atoms['_NET_WM_STATE_MAXIMIZED_VERT']))
      maximizedVert = true;
  }

  if (maximizedHorz && maximizedVert)
    winStates |= ICETRAY_XWINDOW_MAXIMIZED;

  x11.XFree(propsFound);

  return winStates;
};

icetray.Window.getXWindowDesktop = function(xwin) {
  let desktop = null;

  let [propsFound, nitems] =
        icetray.Window.getXWindowProperties(xwin, x11.current.Atoms._NET_WM_DESKTOP);
  log.debug("DESKTOP propsFound, nitems="+propsFound+", "+nitems);
  if (!propsFound) return null;

  if (icetray.js.strEquals(nitems.value, 0))
    log.warn("desktop number not found");
  else if (icetray.js.strEquals(nitems.value, 1))
    desktop = propsFound.contents[0];
  else
    throw new RangeError("more than one desktop found");

  x11.XFree(propsFound);

  return desktop;
};

icetray.Window.correctSubscribedEventMasks = function(gdkWin) {
  let eventMask = gdk.gdk_window_get_events(gdkWin);
  let eventMaskNeeded = gdk.GDK_STRUCTURE_MASK | gdk.GDK_PROPERTY_CHANGE_MASK |
        gdk.GDK_VISIBILITY_NOTIFY_MASK;
  log.debug("eventMask="+eventMask+" eventMaskNeeded="+eventMaskNeeded);
  if ((eventMask & eventMaskNeeded) !== eventMaskNeeded) {
    log.info("subscribing window to missing mandatory event-masks");
    gdk.gdk_window_set_events(gdkWin, eventMask|eventMaskNeeded);
  }
};

icetray.Window.filterWindow = function(xev, gdkEv, data) {
  if (!xev)
    return gdk.GDK_FILTER_CONTINUE;

  let xany = ctypes.cast(xev, x11.XAnyEvent.ptr);
  let xid = xany.contents.window;

  switch (xany.contents.type) {

  case x11.MapNotify:
    log.debug("MapNotify");
    let gdkWinStateOnMap = gdk.gdk_window_get_state(icetray.Handler.gdkWindows.get(xid));
    log.debug("gdkWinState="+gdkWinStateOnMap+" for xid="+xid);
    let win = icetray.Handler.windows[xid];
    if (icetray.Handler.appStarted && !win.visible) {
      // when app hidden at startup, then called from command line without
      // any argument (not through FireTray that is)
      log.warn("window not visible, correcting visibility");
      log.debug("visibleWindowsCount="+icetray.Handler.visibleWindowsCount);
    }
    break;

  case x11.UnmapNotify:       // for catching 'iconify'
    log.debug("UnmapNotify");

    let winStates = icetray.Window.getXWindowStates(xid);
    let isHidden =  winStates & ICETRAY_XWINDOW_HIDDEN;
    log.debug("winStates="+winStates+", isHidden="+isHidden);
    // NOTE: Gecko 8.0 provides the 'sizemodechange' event, which comes once
    // the window is minimized. i.e. preventDefault() or returning false won't
    // prevent the event.
    if (isHidden) {
      log.debug("GOT ICONIFIED");
      icetray.Handler.onMinimize(xid);
    }
    break;

    // default:
    //   log.debug("xany.type="+xany.contents.type);
    //   break;
  }

  return gdk.GDK_FILTER_CONTINUE;
};

icetray.Window.startupFilter = function(xev, gdkEv, data) {
  if (!xev)
    return gdk.GDK_FILTER_CONTINUE;

  let xany = ctypes.cast(xev, x11.XAnyEvent.ptr);
  let xid = xany.contents.window;

  // MapRequest already taken by window manager. Not sure we could be notified
  // *before* the window is actually mapped, in order to minimize it before
  // it's shown.
  if (xany.contents.type === x11.MapNotify) {
    gdk.gdk_window_remove_filter(icetray.Handler.gdkWindows.get(xid),
                                 icetray.Handler.windows[xid].startupFilterCb, null);
    if (icetray.Utils.prefService.getBoolPref('start_hidden')) {
      log.debug("start_hidden");
      icetray.Window.startupHide(xid);
    }
  }

  return gdk.GDK_FILTER_CONTINUE;
};

icetray.Window.showAllWindowsAndActivate = function() {
  let visibilityRate = icetray.Handler.visibleWindowsCount/icetray.Handler.windowsCount;
  log.debug("visibilityRate="+visibilityRate);
  if (visibilityRate < 1)
    icetray.Handler.showAllWindows();

  for(var key in icetray.Handler.windows); // FIXME: this is not the proper way for finding the last registered window !
  icetray.Window.activate(key);
};

icetray.Window.attachOnFocusInCallback = function(xid) {
  log.debug("attachOnFocusInCallback xid="+xid);
  let callback = gtk.GCallbackWidgetFocusEvent_t(
    icetray.Window.onFocusIn, null, ICETRAY_CB_SENTINEL);
  this.signals['focus-in'].callback[xid] = callback;
  let handlerId = gobject.g_signal_connect(
    icetray.Handler.gtkWindows.get(xid), "focus-in-event", callback, null);
  log.debug("focus-in handler="+handlerId);
  this.signals['focus-in'].handler[xid] = handlerId;
};

icetray.Window.detachOnFocusInCallback = function(xid) {
  log.debug("detachOnFocusInCallback xid="+xid);
  let gtkWin = icetray.Handler.gtkWindows.get(xid);
  gobject.g_signal_handler_disconnect(
    gtkWin,
    gobject.gulong(this.signals['focus-in'].handler[xid])
  );
  delete this.signals['focus-in'].callback[xid];
  delete this.signals['focus-in'].handler[xid];
};

// NOTE: fluxbox issues a FocusIn event when switching workspace
// by hotkey, which means 2 FocusIn events when switching to a moz app :(
// (http://sourceforge.net/tracker/index.php?func=detail&aid=3190205&group_id=35398&atid=413960)
icetray.Window.onFocusIn = function(widget, event, data) {
  log.debug("onFocusIn");
  let xid = icetray.Window.getXIDFromGtkWidget(widget);
  log.debug("xid="+xid);

  icetray.Window.setUrgency(xid, false);

  if (icetray.Handler.isChatEnabled() && icetray.Chat.initialized) {
    icetray.Chat.stopGetAttentionMaybe(xid);
  }

  let stopPropagation = false;
  return stopPropagation;
};


///////////////////////// icetray.Handler overriding /////////////////////////

/** debug facility */
icetray.Handler.dumpWindows = function() {
  log.debug(icetray.Handler.windowsCount);
  for (let winId in icetray.Handler.windows) log.info(winId+"="+icetray.Handler.gtkWindows.get(winId));
};

icetray.Handler.registerWindow = function(win) {
  log.debug("register window");

  // register
  let [baseWin, gtkWin, gdkWin, xid] = icetray.Window.getWindowsFromChromeWindow(win);
  this.windows[xid] = {};
  this.windows[xid].chromeWin = win;
  this.windows[xid].baseWin = baseWin;
  Object.defineProperties(this.windows[xid], {
    "visible": { get: function(){return icetray.Window.getVisibility(xid);} }
  });
  icetray.Window.correctSubscribedEventMasks(gdkWin);
  try {
    this.gtkWindows.insert(xid, gtkWin);
    this.gdkWindows.insert(xid, gdkWin);
    icetray.PopupMenu.addWindowItem(xid);
  } catch (x) {
    if (x.name === "RangeError") // instanceof not working :-(
      win.alert(x+"\n\nYou seem to have more than "+ICETRAY_WINDOW_COUNT_MAX
                +" windows open. This breaks FireTray and most probably "
                +icetray.Handler.app.name+".");
  }
  log.debug("window "+xid+" registered");
  // NOTE: shouldn't be necessary to gtk_widget_add_events(gtkWin, gdk.GDK_ALL_EVENTS_MASK);

  try {
     // NOTE: we could try to catch the "delete-event" here and block
     // delete_event_cb (in gtk2/nsWindow.cpp), but we prefer to use the
     // provided 'close' JS event

    this.windows[xid].filterWindowCb = gdk.GdkFilterFunc_t(
      icetray.Window.filterWindow, null, ICETRAY_CB_SENTINEL);
    gdk.gdk_window_add_filter(gdkWin, this.windows[xid].filterWindowCb, null);
    if (!icetray.Handler.appStarted) {
      this.windows[xid].startupFilterCb = gdk.GdkFilterFunc_t(
        icetray.Window.startupFilter, null, ICETRAY_CB_SENTINEL);
      gdk.gdk_window_add_filter(gdkWin, this.windows[xid].startupFilterCb, null);
    }

    icetray.Window.attachOnFocusInCallback(xid);
    if (icetray.Handler.isChatEnabled() && icetray.Chat.initialized) {
      icetray.Chat.attachSelectListeners(win);
    }

  } catch (x) {
    log.error(x);
    icetray.Window.unregisterWindowByXID(xid);
    return null;
  }

  log.debug("AFTER"); icetray.Handler.dumpWindows();
  return xid;
};

icetray.Handler.unregisterWindow = function(win) {
  log.debug("unregister window");
  let xid = icetray.Window.getRegisteredWinIdFromChromeWindow(win);
  return icetray.Window.unregisterWindowByXID(xid);
};

icetray.Handler.showWindow = icetray.Window.show;
icetray.Handler.hideWindow = icetray.Window.hide;

icetray.Handler.showAllWindowsAndActivate = icetray.Window.showAllWindowsAndActivate;

/* NOTE: gtk_window_is_active() not reliable, and _NET_ACTIVE_WINDOW may not
   always be set before 'focus-in-event' (gnome-shell/mutter 3.4.1). */
icetray.Handler.getActiveWindow = function() {
  let gdkActiveWin = gdk.gdk_screen_get_active_window(gdk.gdk_screen_get_default()); // inspects _NET_ACTIVE_WINDOW
  log.debug("gdkActiveWin="+gdkActiveWin);
  if (icetray.js.strEquals(gdkActiveWin, 'GdkWindow.ptr(ctypes.UInt64("0x0"))'))
    return null;
  let activeWin = icetray.Window.getXIDFromGdkWindow(gdkActiveWin);
  log.debug("ACTIVE_WINDOW="+activeWin);
  return activeWin;
};

icetray.Handler.windowGetAttention = function(winId) {
  icetray.Window.setUrgency(winId, true);
};


/**
 * init X11 Display and handled XAtoms.
 * Needs to be defined and called outside x11.jsm because: 1. gdk already
 * imports x11, 2. there is no means to get the default Display solely with
 * Xlib without opening one... :-(
 */
x11.init = function() {
  if (!icetray.js.isEmpty(this.current))
    return true; // init only once

  this.current = {};
  try {
    let gdkDisplay = gdk.gdk_display_get_default();
    this.current.Display = gdk.gdk_x11_display_get_xdisplay(gdkDisplay);
    this.current.Atoms = {};
    XATOMS.forEach(function(atomName, index, array) {
      this.current.Atoms[atomName] = x11.XInternAtom(this.current.Display, atomName, 0);
      log.debug("x11.current.Atoms."+atomName+"="+this.current.Atoms[atomName]);
    }, this);
    return true;
  } catch (x) {
    log.error(x);
    return false;
  }
};
x11.init();
