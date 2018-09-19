/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

var EXPORTED_SYMBOLS = [ "icetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://icetray/commons.js"); // first for Handler.app !
Cu.import("resource://icetray/ctypes/linux/gobject.jsm");
// FIXME: can't subscribeLibsForClosing([appind])
// https://bugs.launchpad.net/ubuntu/+source/firefox/+bug/1393256
Cu.import("resource://icetray/ctypes/linux/"+icetray.Handler.app.widgetTk+"/appindicator.jsm");
Cu.import("resource://icetray/ctypes/linux/"+icetray.Handler.app.widgetTk+"/gtk.jsm");
icetray.Handler.subscribeLibsForClosing([gobject, gtk]);

let log = icetray.Logging.getLogger("icetray.AppIndicator");

if ("undefined" == typeof(icetray.StatusIcon))
  log.error("This module MUST be imported from/after IcetrayStatusIcon !");


icetray.AppIndicator = {
  initialized: false,
  callbacks: {},
  indicator: null,

  init: function() {
    this.indicator = appind.app_indicator_new(
      ICETRAY_APPINDICATOR_ID,
      icetray.StatusIcon.defaultAppIconName,
      appind.APP_INDICATOR_CATEGORY_COMMUNICATIONS
    );
    appind.app_indicator_set_icon_theme_path(
      this.indicator, icetray.StatusIcon.THEME_ICON_PATH);
    appind.app_indicator_set_status(this.indicator,
                                    appind.APP_INDICATOR_STATUS_ACTIVE);
    appind.app_indicator_set_menu(this.indicator,
                                  icetray.PopupMenu.menu); // mandatory
    log.debug("indicator="+this.indicator);

    this.addCallbacks();

    for (let item in icetray.PopupMenu.menuItem) {
      icetray.PopupMenu.showItem(icetray.PopupMenu.menuItem[item]);
    }

    this.attachMiddleClickCallback();
    icetray.Handler.setIconTooltipDefault();

    this.initialized = true;
    return true;
  },

  shutdown: function() {
    log.debug("Disabling AppIndicator");
    gobject.g_object_unref(this.indicator);
    this.initialized = false;
  },

  addCallbacks: function() {
    this.callbacks.connChanged = appind.ConnectionChangedCb_t(
      icetray.AppIndicator.onConnectionChanged); // void return, no sentinel
    gobject.g_signal_connect(this.indicator, "connection-changed",
                             icetray.AppIndicator.callbacks.connChanged, null);

    this.callbacks.onScroll = appind.OnScrollCb_t(
      icetray.AppIndicator.onScroll); // void return, no sentinel
    gobject.g_signal_connect(this.indicator, "scroll-event",
                             icetray.AppIndicator.callbacks.onScroll, null);
  },

  attachMiddleClickCallback: function() {
    let pref = icetray.Utils.prefService.getIntPref("middle_click");
    if (pref === ICETRAY_MIDDLE_CLICK_ACTIVATE_LAST) {
      item = icetray.PopupMenu.menuItem.activateLast;
      icetray.PopupMenu.showItem(icetray.PopupMenu.menuItem.activateLast);
    } else if (pref === ICETRAY_MIDDLE_CLICK_SHOW_HIDE) {
      item = icetray.PopupMenu.menuItem.showHide;
      icetray.PopupMenu.hideItem(icetray.PopupMenu.menuItem.activateLast);
    } else {
      log.error("Unknown pref value for 'middle_click': "+pref);
      return false;
    }
    let menuItemShowHideWidget = ctypes.cast(item, gtk.GtkWidget.ptr);
    appind.app_indicator_set_secondary_activate_target(
      this.indicator, menuItemShowHideWidget);
    return true;
  },

  onConnectionChanged: function(indicator, connected, data) {
    log.debug("AppIndicator connection-changed: "+connected);
  },

  // https://bugs.kde.org/show_bug.cgi?id=340978 broken under KDE4
  onScroll: function(indicator, delta, direction, data) { // AppIndicator*, gint, GdkScrollDirection, gpointer
    log.debug("onScroll: "+direction);
    icetray.StatusIcon.onScroll(direction);
  },

};  // AppIndicator

icetray.StatusIcon.initImpl =
  icetray.AppIndicator.init.bind(icetray.AppIndicator);

icetray.StatusIcon.shutdownImpl =
  icetray.AppIndicator.shutdown.bind(icetray.AppIndicator);


icetray.Handler.setIconImageDefault = function() {
  log.debug("setIconImageDefault");
  appind.app_indicator_set_icon_full(icetray.AppIndicator.indicator,
                                     icetray.StatusIcon.defaultAppIconName,
                                     icetray.Handler.app.name);
};

icetray.Handler.setIconImageNewMail = function() {
  log.debug("setIconImageNewMail");
  appind.app_indicator_set_icon_full(
    icetray.AppIndicator.indicator,
    icetray.StatusIcon.defaultNewMailIconName,
    icetray.Handler.app.name);
};

icetray.Handler.setIconImageCustom = function(prefname) {
  let prefCustomIconPath = icetray.Utils.prefService.getCharPref(prefname);
  // Undocumented: ok to pass a *path* instead of an icon name! Otherwise we
  // should be changing the default icons (which is maybe a better
  // implementation anyway)...
  appind.app_indicator_set_icon_full(
    icetray.AppIndicator.indicator, prefCustomIconPath,
    icetray.Handler.app.name);
};

// No tooltips in AppIndicator
// https://bugs.launchpad.net/indicator-application/+bug/527458
icetray.Handler.setIconTooltip = function(toolTipStr) {
  log.debug("setIconTooltip");
  if (!icetray.AppIndicator.indicator)
    return false;
  icetray.PopupMenu.setItemLabel(icetray.PopupMenu.menuItem.tip,
                                  toolTipStr);
  return true;
};

// AppIndicator doesn't support pixbuf https://bugs.launchpad.net/bugs/812067
icetray.Handler.setIconText = function(text, color) { };

icetray.Handler.setIconVisibility = function(visible) {
  if (!icetray.AppIndicator.indicator)
    return false;

  let status = visible ?
        appind.APP_INDICATOR_STATUS_ACTIVE :
        appind.APP_INDICATOR_STATUS_PASSIVE;
  appind.app_indicator_set_status(icetray.AppIndicator.indicator, status);
  return true;
};
