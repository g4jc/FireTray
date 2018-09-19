/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

var EXPORTED_SYMBOLS = [ "icetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://icetray/commons.js"); // first for Handler.app !
Cu.import("resource://icetray/ctypes/ctypesMap.jsm");
Cu.import("resource://icetray/ctypes/linux/gio.jsm");
Cu.import("resource://icetray/ctypes/linux/gobject.jsm");
Cu.import("resource://icetray/ctypes/linux/"+icetray.Handler.app.widgetTk+"/gdk.jsm");
Cu.import("resource://icetray/ctypes/linux/"+icetray.Handler.app.widgetTk+"/gtk.jsm");
Cu.import("resource://icetray/linux/IcetrayGtkIcons.jsm");
Cu.import("resource://icetray/linux/IcetrayWindow.jsm");
icetray.Handler.subscribeLibsForClosing([gdk, gio, gobject, gtk]);

if ("undefined" == typeof(icetray.Handler))
  log.error("This module MUST be imported from/after IcetrayHandler !");

let log = icetray.Logging.getLogger("icetray.ChatStatusIcon");

const ALPHA_STEP                       = 5;
const ALPHA_STEP_SLEEP_MILLISECONDS    = 10;
const FADE_OVER_SLEEP_MILLISECONDS     = 500;
const BLINK_TOGGLE_PERIOD_MILLISECONDS = 500;


icetray.ChatStatusIcon = {
  GTK_THEME_ICON_PATH: null,

  initialized: false,
  trayIcon: null,
  themedIcons: (function(){let o = {};
    o[ICETRAY_IM_STATUS_AVAILABLE] = null;
    o[ICETRAY_IM_STATUS_AWAY] = null;
    o[ICETRAY_IM_STATUS_BUSY] = null;
    o[ICETRAY_IM_STATUS_OFFLINE] = null;
    return o;
  })(),
  themedIconNameCurrent: null,
  timers: {'blink': null, 'fade-step': null, 'fade-loop': null},
  events: {},
  generators: {},
  pixBuffer: {},
  get isBlinking () {return (icetray.Chat.convsToAcknowledge.length() > 0);},

  init: function() {
    if (!icetray.Handler.appHasChat) throw "ChatStatusIcon for chat app only";

    this.trayIcon = gtk.gtk_status_icon_new();
    icetray.GtkIcons.init();
    this.loadThemedIcons();
    this.setIconImage(this.themedIconNameCurrent || ICETRAY_IM_STATUS_OFFLINE); // updated in Chat anyway
    this.setIconTooltipDefault();
    this.initTimers();

    this.initialized = true;
    return true;
  },

  shutdown: function() {
    this.destroyTimers();
    this.destroyIcons();
    icetray.GtkIcons.shutdown();
    this.initialized = false;
  },

  loadThemedIcons: function() {
    for (let name in this.themedIcons)
      this.themedIcons[name] = gio.g_themed_icon_new(name);
  },

  destroyIcons: function() {
    for (let name in this.themedIcons) {
      let gicon = this.themedIcons[name];
      gicon = gobject.g_object_unref(gicon);
    }
    gobject.g_object_unref(this.trayIcon);
  },

  setIconImageFromGIcon: function(gicon) {
    if (!icetray.ChatStatusIcon.trayIcon || !gicon)
      log.error("Icon missing");
    gtk.gtk_status_icon_set_from_gicon(icetray.ChatStatusIcon.trayIcon, gicon);
  },

  setIconImage: function(name) {
    this.themedIconNameCurrent = name;

    let blinkStyle = icetray.Utils.prefService.getIntPref("chat_icon_blink_style");
    if (blinkStyle === ICETRAY_CHAT_ICON_BLINK_STYLE_FADE &&
        this.isBlinking) {
      this.events['icon-changed'] = true;
      return;
    }

    this.setIconImageFromGIcon(this.themedIcons[name]);
  },

  setIconVoid: function() {
    gtk.gtk_status_icon_set_from_pixbuf(this.trayIcon, null);
  },

  initTimers: function() {
    for (let tname in this.timers)
      this.timers[tname] = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  },

  destroyTimers: function() {
    for (let tname in this.timers) {
      this.timers[tname].cancel();
      this.timers[tname] = null;
    }
    this.events = {};
  },

  buildPixBuf: function() {
    let icon_theme = gtk.gtk_icon_theme_get_for_screen(gdk.gdk_screen_get_default());

    // get pixbuf
    let arry = gobject.gchar.ptr.array()(2);
    arry[0] = gobject.gchar.array()(icetray.ChatStatusIcon.themedIconNameCurrent);
    arry[1] = null;
    log.debug("icon name="+icetray.ChatStatusIcon.themedIconNameCurrent+", theme="+icon_theme+", arry="+arry);
    let icon_info = gtk.gtk_icon_theme_choose_icon(icon_theme, arry, 22, gtk.GTK_ICON_LOOKUP_FORCE_SIZE);

    // create pixbuf
    let pixbuf = gdk.gdk_pixbuf_copy(gtk.gtk_icon_info_load_icon(icon_info, null));
if (gtk.gtk_get_major_version() == 3 && gtk.gtk_get_minor_version() >= 8) { // gtk3
    gobject.g_object_unref(icon_info);
} else {
    gtk.gtk_icon_info_free(icon_info);
}

    // checks
    if (gdk.gdk_pixbuf_get_colorspace(pixbuf) != gdk.GDK_COLORSPACE_RGB)
      log.error("wrong colorspace for pixbuf");
    if (gdk.gdk_pixbuf_get_bits_per_sample(pixbuf) != 8)
      log.error("wrong bits_per_sample for pixbuf");
    if (!gdk.gdk_pixbuf_get_has_alpha(pixbuf))
      log.error("pixbuf doesn't have alpha");
    let n_channels = gdk.gdk_pixbuf_get_n_channels(pixbuf);
    if (n_channels != 4)
      log.error("wrong nb of channels for pixbuf");

    // init transform
    let width = gdk.gdk_pixbuf_get_width(pixbuf);
    let height = gdk.gdk_pixbuf_get_height(pixbuf);
    log.debug("width="+width+", height="+height);
    let length = width*height*n_channels;
    let pixels = ctypes.cast(gdk.gdk_pixbuf_get_pixels(pixbuf),
                             gobject.guchar.array(length).ptr);
    log.debug("pixels="+pixels);

    // backup alpha for later fade-in
    let buffer = new ArrayBuffer(width*height);
    let alpha_bak = new Uint8Array(buffer);
    for (let i=3; i<length; i+=n_channels)
      alpha_bak[(i-3)/n_channels] = pixels.contents[i];

    log.debug("pixbuf created");
    this.pixBuffer = {
      pixbuf: pixbuf,           // TO BE UNREFED WITH to g_object_unref() !!
      width: width,
      height: height,
      length: length,
      n_channels: n_channels,
      pixels: pixels,
      buffer: buffer,
      alpha_bak: alpha_bak
    };
  },
  dropPixBuf: function() {
    gobject.g_object_unref(this.pixBuffer.pixbuf);
    log.debug("pixbuf unref'd");
    this.pixBuffer = {};
  },

  fadeGenerator: function() {
    let pixbuf = icetray.ChatStatusIcon.pixBuffer;

    for (let a=255; a>0; a-=ALPHA_STEP) {
      for(let i=3; i<pixbuf.length; i+=pixbuf.n_channels)
        if (pixbuf.pixels.contents[i]-ALPHA_STEP>0)
          pixbuf.pixels.contents[i] -= ALPHA_STEP;
      gtk.gtk_status_icon_set_from_pixbuf(icetray.ChatStatusIcon.trayIcon, pixbuf.pixbuf);
      yield true;
    }

    for (let a=255; a>0; a-=ALPHA_STEP) {
      for(let i=3; i<pixbuf.length; i+=pixbuf.n_channels)
        if (pixbuf.pixels.contents[i]+ALPHA_STEP<=pixbuf.alpha_bak[(i-3)/pixbuf.n_channels]) {
          pixbuf.pixels.contents[i] += ALPHA_STEP;
        }
      gtk.gtk_status_icon_set_from_pixbuf(icetray.ChatStatusIcon.trayIcon, pixbuf.pixbuf);
      yield true;
    }
  },

  fadeStep: function() {
    try {
      if (icetray.ChatStatusIcon.generators['fade'].next())
        icetray.ChatStatusIcon.timers['fade-step'].initWithCallback(
          { notify: icetray.ChatStatusIcon.fadeStep },
          ALPHA_STEP_SLEEP_MILLISECONDS, Ci.nsITimer.TYPE_ONE_SHOT);

    } catch (e if e instanceof StopIteration) {

      if (icetray.ChatStatusIcon.events['stop-fade']) {
        log.debug("stop-fade");
        delete icetray.ChatStatusIcon.events['stop-fade'];
        delete icetray.ChatStatusIcon.generators['fade'];
        icetray.ChatStatusIcon.setIconImage(icetray.ChatStatusIcon.themedIconNameCurrent);
        icetray.ChatStatusIcon.dropPixBuf();
        return;
      }

      if (icetray.ChatStatusIcon.events['icon-changed']) {
        delete icetray.ChatStatusIcon.events['icon-changed'];
        icetray.ChatStatusIcon.dropPixBuf();
        icetray.ChatStatusIcon.buildPixBuf();
        icetray.ChatStatusIcon.timers['fade-loop'].initWithCallback(
          { notify: icetray.ChatStatusIcon.fadeLoop },
          FADE_OVER_SLEEP_MILLISECONDS, Ci.nsITimer.TYPE_ONE_SHOT);

      } else {
        icetray.ChatStatusIcon.timers['fade-loop'].initWithCallback(
          { notify: icetray.ChatStatusIcon.fadeLoop },
          FADE_OVER_SLEEP_MILLISECONDS, Ci.nsITimer.TYPE_ONE_SHOT);
      }
    };
  },

  fadeLoop: function() {
    icetray.ChatStatusIcon.generators['fade'] = icetray.ChatStatusIcon.fadeGenerator();
    icetray.ChatStatusIcon.fadeStep();
  },

  startFading: function() {
    log.debug("startFading");
    this.buildPixBuf();
    this.fadeLoop();
  },

  stopFading: function() {
    log.debug("stopFading");
    this.events['stop-fade'] = true;
  },

  startBlinking: function() { // gtk_status_icon_set_blinking() deprecated
    this.on = true;
    icetray.ChatStatusIcon.timers['blink'].initWithCallback({
      notify: function() {
        if (icetray.ChatStatusIcon.on)
          icetray.ChatStatusIcon.setIconVoid();
        else
          icetray.ChatStatusIcon.setIconImage(icetray.ChatStatusIcon.themedIconNameCurrent);
        icetray.ChatStatusIcon.on = !icetray.ChatStatusIcon.on;
      }
    }, BLINK_TOGGLE_PERIOD_MILLISECONDS, Ci.nsITimer.TYPE_REPEATING_SLACK);
  },

  stopBlinking: function() {
    log.debug("stopBlinking");
    this.timers['blink'].cancel();
    this.setIconImage(icetray.ChatStatusIcon.themedIconNameCurrent);
    this.on = false;
  },

  toggleBlinkStyle: function(blinkStyle) {
    switch (blinkStyle) {
    case ICETRAY_CHAT_ICON_BLINK_STYLE_NORMAL:
      this.stopFading();
      this.startBlinking();
      break;
    case ICETRAY_CHAT_ICON_BLINK_STYLE_FADE:
      this.stopBlinking();
      this.startFading();
      break;
    default:
      throw new Error("Undefined chat icon blink style.");
    }
  },

  setUrgency: function(xid, urgent) {
    gtk.gtk_window_set_urgency_hint(icetray.Handler.gtkWindows.get(xid), urgent);
  },

  setIconTooltip: function(txt) {
    if (!this.trayIcon) return false;
    gtk.gtk_status_icon_set_tooltip_text(this.trayIcon, txt);
    return true;
  },

  setIconTooltipDefault: function() {
    this.setIconTooltip(icetray.Handler.app.name+" Chat");
  }

  // TODO: onclick/activate -> chatHandler.showCurrentConversation()

}; // icetray.ChatStatusIcon
