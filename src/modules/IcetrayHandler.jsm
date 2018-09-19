/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
"use strict";

var EXPORTED_SYMBOLS = [ "icetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://icetray/commons.js");
Cu.import("resource://icetray/PrefListener.jsm");
Cu.import("resource://icetray/VersionChange.jsm");

/**
 * icetray namespace.
 */
if ("undefined" == typeof(icetray)) {
  var icetray = {};
};

let log = icetray.Logging.getLogger("icetray.Handler");

/**
 * Singleton object and abstraction for windows and tray icon management.
 */
// NOTE: modules work outside of the window scope. Unlike scripts in the
// chrome, modules don't have access to objects such as window, document, or
// other global functions
// (https://developer.mozilla.org/en/XUL_School/JavaScript_Object_Management)
icetray.Handler = {

  initialized: false,
  timers: {},
  inBrowserApp: false,
  inMailApp: false,
  appHasChat: false,
  appStarted: false,
  useAppind: false,             // initialized in StatusIcon
  windows: {},
  get windowsCount() {return Object.keys(this.windows).length;},
  get visibleWindowsCount() {
    let count = 0;
    for (let wid in icetray.Handler.windows) {
      if (icetray.Handler.windows[wid].visible) count += 1;
    }
    return count;
  },
  observedTopics: {},
  ctypesLibs: {},               // {"lib1": lib1, "lib2": lib2}

  app: (function(){return {
    id: Services.appinfo.ID,
    name: Services.appinfo.name,
    // Services.vc.compare(version,"2.0a")>=0
    version: Services.appinfo.platformVersion,
    ABI: Services.appinfo.XPCOMABI,
    OS: Services.appinfo.OS.toLowerCase(), // "WINNT", "Linux", "Darwin"
    widgetTk: Services.appinfo.widgetToolkit,
  };})(),

  support: {chat: false, winnt: false},

  init: function() {            // does creates icon
    icetray.PrefListener.register(false);
    icetray.MailChatPrefListener.register(false);

    log.info("OS=" + this.app.OS +
             ", ABI=" + this.app.ABI +
             ", platformVersion=" + this.app.version +
             ", widgetToolkit=" + this.app.widgetTk);
    if (ICETRAY_OS_SUPPORT.indexOf(this.app.OS) < 0) {
      let platforms = ICETRAY_OS_SUPPORT.join(", ");
      log.error("Only "+platforms+" platform(s) supported at this time. Icetray not loaded");
      return false;
    } else if (this.app.OS == "winnt" &&
               Services.vc.compare(this.app.version,"27.0") < 0) {
      log.error("FireTray needs Gecko 27 and above on Windows.");
      return false;
    } else if (this.app.OS == "freebsd") {
      this.app.OS = "linux";
    }

    Cu.import("resource://icetray/"+this.app.OS+"/IcetrayStatusIcon.jsm");
    log.debug("IcetrayStatusIcon "+this.app.OS+" imported");
    log.info("useAppind="+icetray.Handler.useAppind);
    Cu.import("resource://icetray/"+this.app.OS+"/IcetrayWindow.jsm");
    log.debug("IcetrayWindow "+this.app.OS+" imported");

    this.support['chat']  =
      ['linux'].indexOf(this.app.OS) > -1 && !this.useAppind;
    this.support['winnt'] =
      ['winnt'].indexOf(icetray.Handler.app.OS) > -1;

    if (this.app.id === ICETRAY_APP_DB['icedoveuxp']['id'] ||
        this.app.id === ICETRAY_APP_DB['iceapeuxp']['id'])
      this.inMailApp = true;
    if (this.app.id === ICETRAY_APP_DB['iceweaseluxp']['id'] ||
        this.app.id === ICETRAY_APP_DB['iceapeuxp']['id'])
      this.inBrowserApp = true;
    if (this.app.id === ICETRAY_APP_DB['icedoveuxp']['id'] &&
        Services.vc.compare(this.app.version,"15.0")>=0)
      this.appHasChat = true;
    log.info('inMailApp='+this.inMailApp+', inBrowserApp='+this.inBrowserApp+
      ', appHasChat='+this.appHasChat);

    icetray.Window.init();
    icetray.StatusIcon.init();
    icetray.Handler.showHideIcon();
    log.debug('StatusIcon initialized');

    if (this.inMailApp) {
      try {
        Cu.import("resource:///modules/mailServices.js");
        Cu.import("resource://icetray/IcetrayMessaging.jsm");
        if (icetray.Utils.prefService.getBoolPref("mail_notification_enabled")) {
          icetray.Messaging.init();
          icetray.Messaging.updateMsgCountWithCb();
        }
      } catch (x) {
        log.error(x);
        return false;
      }
    }

    let chatIsProvided = this.isChatProvided();
    log.info('isChatProvided='+chatIsProvided);
    if (chatIsProvided) {
      if (this.support['chat']) {
        Cu.import("resource://icetray/IcetrayMessaging.jsm"); // needed for existsChatAccount
        Cu.import("resource://icetray/"+this.app.OS+"/IcetrayChat.jsm");
        icetray.Utils.addObservers(icetray.Handler, [
          "account-added", "account-removed"]);
        if (icetray.Utils.prefService.getBoolPref("chat_icon_enable") &&
            this.existsChatAccount())
          icetray.Chat.init();
      } else {
        log.warn("Chat not supported for this environment. Chat not loaded");
      }
    }

    icetray.Utils.addObservers(icetray.Handler,
      [ "xpcom-will-shutdown", "profile-change-teardown" ]);
    if (this.app.id === ICETRAY_APP_DB['iceweaseluxp']['id'] ||
        this.app.id === ICETRAY_APP_DB['iceapeuxp']['id']) {
      icetray.Utils.addObservers(icetray.Handler, [ "sessionstore-windows-restored" ]);
    } else if (this.app.id === ICETRAY_APP_DB['icedoveuxp']['id']) {
      this.restoredWindowsCount = this.readTBRestoreWindowsCount();
      log.info("restoredWindowsCount="+this.restoredWindowsCount);
      if (!this.restoredWindowsCount) {
        log.warn("session file could not be read");
        this.restoredWindowsCount = 1; // default
      }
      icetray.Utils.addObservers(icetray.Handler, [ "mail-startup-done" ]);
    } else {
      icetray.Utils.addObservers(icetray.Handler, [ "final-ui-startup" ]);
    }

    this.disablePrefsTmp();

    VersionChange.init(ICETRAY_ID, ICETRAY_VERSION, ICETRAY_PREF_BRANCH);
    let vc = VersionChange, vch = icetray.VersionChangeHandler;
    vc.addHook(["upgrade", "reinstall"], vch.deleteOrRenameOldOptions);
    vc.addHook(["upgrade", "reinstall"], vch.correctMailNotificationType);
    vc.addHook(["upgrade", "reinstall"], vch.correctMailServerTypes);
    if (this.inMailApp) {
      vc.addHook(["upgrade", "reinstall"], icetray.Messaging.cleanExcludedAccounts);
    }
    vc.applyHooksAndWatchUninstall();

    this.initialized = true;
    return true;
  },

  shutdown: function() {
    log.debug("Disabling Handler");
    if (icetray.Handler.isChatProvided() && icetray.Handler.support['chat']
        && icetray.Chat.initialized)
      icetray.Chat.shutdown();

    if (this.inMailApp)
      icetray.Messaging.shutdown();
    icetray.StatusIcon.shutdown();
    icetray.Window.shutdown();
    this.tryCloseLibs();

    icetray.Utils.removeAllObservers(this);

    icetray.MailChatPrefListener.unregister(false);
    icetray.PrefListener.unregister();

    this.appStarted = false;
    this.initialized = false;
    return true;
  },

  isChatEnabled: function() {
    return this.isChatProvided() &&
      icetray.Utils.prefService.getBoolPref("chat_icon_enable");
  },

  isChatProvided: function() {
    return this.appHasChat && Services.prefs.getBoolPref("mail.chat.enabled");
  },

  subscribeLibsForClosing: function(libs) {
    for (let i=0, len=libs.length; i<len; ++i) {
      let lib = libs[i];
      if (!this.ctypesLibs.hasOwnProperty(lib.name))
        this.ctypesLibs[lib.name] = lib;
    }
  },

  tryCloseLibs: function() {
    try {
      for (let libName in this.ctypesLibs) {
        let lib = this.ctypesLibs[libName];
        if (lib.available())
          lib.close();
      };
    } catch(x) { log.error(x); }
  },

  readTBRestoreWindowsCount: function() {
    Cu.import("resource:///modules/IOUtils.js");
    let sessionFile = Services.dirsvc.get("ProfD", Ci.nsIFile);
    sessionFile.append("session.json");
    var initialState = null;
    if (sessionFile.exists()) {
      let data = IOUtils.loadFileToString(sessionFile);
      if (!data) return null;
      try {
        initialState = JSON.parse(data);
      } catch(x) {}
      if (!initialState) return null;

      return  initialState.windows.length;
    }
    return null;
  },

  // FIXME: this should definetely be done in Chat, but IM accounts
  // seem not be initialized at early stage (Exception... "'TypeError:
  // this._items is undefined' when calling method:
  // [nsISimpleEnumerator::hasMoreElements]"), and we're unsure if we should
  // initAccounts() ourselves...
  existsChatAccount: function() {
    let accounts = new icetray.Messaging.Accounts();
    for (let accountServer in accounts)
      if (accountServer.type === ICETRAY_ACCOUNT_SERVER_TYPE_IM)  {
        log.debug("found im server: "+accountServer.prettyName);
        return true;
      }

    return false;
  },

  startupDone: function() {
    icetray.Handler.timers['startup-done'] =
      icetray.Utils.timer(ICETRAY_DELAY_STARTUP_MILLISECONDS,
        Ci.nsITimer.TYPE_ONE_SHOT, function() {
          icetray.Handler.appStarted = true;
          log.info("*** appStarted ***");

          if (icetray.Handler.inMailApp) {
            icetray.Messaging.addPrefObserver();
          }
        });
  },

  observe: function(subject, topic, data) {
    switch (topic) {

    case "sessionstore-windows-restored":
      // sessionstore-windows-restored does not come after the realization of
      // all windows... so we wait a little
    case "final-ui-startup":    // subject=ChromeWindow
      log.debug(topic+": "+subject+","+data);
      icetray.Utils.removeObservers(icetray.Handler, [ topic ]);
      icetray.Handler.startupDone();
      break;

    case "mail-startup-done": // or xul-window-visible, mail-tabs-session-restored ?
      log.debug(topic+": "+subject+","+data);
      if (icetray.Handler.restoredWindowsCount &&
          !--icetray.Handler.restoredWindowsCount) {
        icetray.Utils.removeObservers(icetray.Handler, [ topic ]);
        icetray.Handler.startupDone();
      }
      break;

    case "xpcom-will-shutdown":
      log.debug("xpcom-will-shutdown");
      this.shutdown();
      break;
    case "profile-change-teardown": // also found "quit-application-granted"
      if (data === 'shutdown-persist')
        this.restorePrefsTmp();
      break;

    case "account-removed":     // emitted by IM
      if (!this.existsChatAccount())
        icetray.Handler.toggleChat(false);
      break;
    case "account-added":       // emitted by IM
      if (!icetray.Chat.initialized)
        icetray.Handler.toggleChat(true);
      break;

    default:
      log.warn("unhandled topic: "+topic);
    }
  },

  toggleChat: function(enabled) {
    log.debug("Chat icon enable="+enabled);

    if (enabled) {
      icetray.Chat.init();
      for (let winId in icetray.Handler.windows) {
        icetray.Chat.attachSelectListeners(icetray.Handler.windows[winId].chromeWin);
      }

    } else {
      for (let winId in icetray.Handler.windows) {
        icetray.Chat.detachSelectListeners(icetray.Handler.windows[winId].chromeWin);
      }
      icetray.Chat.shutdown();
    }
  },

  // these get overridden in OS-specific Icon/Window handlers
  loadIcons: function() {},
  loadImageCustom: function(prefname) {},
  setIconImageDefault: function() {},
  setIconImageNewMail: function() {},
  setIconImageCustom: function(prefname) {},
  setIconText: function(text, color) {},
  setIconTooltip: function(localizedMessage) {},
  setIconTooltipDefault: function() {},
  setIconVisibility: function(visible) {},
  registerWindow: function(win) {},
  unregisterWindow: function(win) {},
  hideWindow: function(winId) {},
  showWindow: function(winId) {},
  showAllWindowsAndActivate:function() {}, // linux
  getActiveWindow: function() {},
  windowGetAttention: function(winId) {},
  showHidePopupMenuItems: function() {}, // linux
  addPopupWindowItemAndSeparatorMaybe: function(wid) {}, // winnt
  removePopupWindowItemAndSeparatorMaybe: function(wid) {}, // winnt

  showAllWindows: function() {
    log.debug("showAllWindows");
    for (let winId in icetray.Handler.windows) {
      if (!icetray.Handler.windows[winId].visible)
        icetray.Handler.showWindow(winId);
    }
  },
  hideAllWindows: function() {
    log.debug("hideAllWindows");
    for (let winId in icetray.Handler.windows) {
      if (icetray.Handler.windows[winId].visible)
        icetray.Handler.hideWindow(winId);
    }
  },

  showHideAllWindows: function() {
    log.debug("showHideAllWindows");
    log.debug("  visibleWindowsCount="+icetray.Handler.visibleWindowsCount+" / windowsCount="+icetray.Handler.windowsCount);
    let visibilityRate = icetray.Handler.visibleWindowsCount /
          icetray.Handler.windowsCount;
    log.debug("  visibilityRate="+visibilityRate);
    if ((0.5 < visibilityRate) && (visibilityRate < 1)
        || visibilityRate === 0) { // TODO: should be configurable
      icetray.Handler.showAllWindows();
    } else {
      icetray.Handler.hideAllWindows();
    }
  },

  onMinimize: function(wid) {
    log.debug("onMinimize");
    let hidden = false;
    if (icetray.Utils.prefService.getBoolPref('hides_on_minimize')) {
      if (icetray.Utils.prefService.getBoolPref('hides_single_window'))
        icetray.Handler.hideWindow(wid);
      else
        icetray.Handler.hideAllWindows();
      hidden = true;
    }
    return hidden;
  },

  showHideIcon: function(msgCount) {
    let allWindowsVisible = true;
    if (icetray.Utils.prefService.getBoolPref('show_icon_on_hide')) {
      allWindowsVisible =
        (icetray.Handler.visibleWindowsCount !== icetray.Handler.windowsCount);
    }

    let msgCountPositive = true;
    if (icetray.Utils.prefService.getBoolPref('nomail_hides_icon') &&
        ("undefined" !== typeof(msgCount))) {
      msgCountPositive = (msgCount > 0);
      log.info("__msgCountPositive="+msgCountPositive);
    }

    log.debug("allWindowsVisible="+allWindowsVisible+" msgCountPositive="+msgCountPositive);
    icetray.Handler.setIconVisibility(allWindowsVisible && msgCountPositive);
  },

  /** nsIBaseWindow, nsIXULWindow, ... */
  getWindowInterface: function(win, iface) {
    let winInterface, winOut;
    try {                       // thx Neil Deakin !!
      winInterface =  win.QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIWebNavigation)
        .QueryInterface(Ci.nsIDocShellTreeItem)
        .treeOwner
        .QueryInterface(Ci.nsIInterfaceRequestor);
    } catch (ex) {
      // ignore no-interface exception
      log.error(ex);
      return null;
    }

    if (iface == "nsIBaseWindow")
      winOut = winInterface[iface];
    else if (iface == "nsIXULWindow")
      winOut = winInterface.getInterface(Ci.nsIXULWindow);
    else {
      log.error("unknown iface '" + iface + "'");
      return null;
    }

    return winOut;
  },

  _getBrowserProperties: function() {
    if (icetray.Handler.app.id === ICETRAY_APP_DB['iceweaseluxp']['id'])
      return "chrome://branding/locale/browserconfig.properties";
    else if (icetray.Handler.app.id === ICETRAY_APP_DB['iceapeuxp']['id'])
      return "chrome://navigator-region/locale/region.properties";
    else return null;
  },

  _getHomePage: function() {
    var prefDomain = "browser.startup.homepage";
    var url;
    try {
      url = Services.prefs.getComplexValue(prefDomain,
        Components.interfaces.nsIPrefLocalizedString).data;
    } catch (e) {}

    if (url) {
      try {
        Services.io.newURI(url, null, null);
      } catch (e) {
        url = "http://" + url;
      }
    }
    else {
      var SBS = Cc["@mozilla.org/intl/stringbundle;1"].getService(Ci.nsIStringBundleService);
      var configBundle = SBS.createBundle(icetray.Handler._getBrowserProperties());
      url = configBundle.GetStringFromName(prefDomain);
    }

    return url;
  },

  openPrefWindow: function() {
    if (null == icetray.Handler._preferencesWindow ||
        icetray.Handler._preferencesWindow.closed) {
      for(var first in icetray.Handler.windows) break;
      icetray.Handler._preferencesWindow =
        icetray.Handler.windows[first].chromeWin.openDialog(
          "chrome://icetray/content/options.xul", null,
          "chrome,titlebar,toolbar,centerscreen", null);
    }

    icetray.Handler._preferencesWindow.focus();
  },

  openBrowserWindow: function() {
    try {
      var home = icetray.Handler._getHomePage();
      log.debug("home="+home);

      // FIXME: obviously we need to wait to avoid seg fault on jsapi.cpp:827
      // 827         if (t->data.requestDepth) {
      icetray.Handler.timers['open-browser-window'] =
        icetray.Utils.timer(ICETRAY_DELAY_NOWAIT_MILLISECONDS,
          Ci.nsITimer.TYPE_ONE_SHOT, function() {
            for(var first in icetray.Handler.windows) break;
            icetray.Handler.windows[first].chromeWin.open(home);
          });
    } catch (x) { log.error(x); }
  },

  openMailMessage: function() {
    try {
      var aURI = Services.io.newURI("mailto:", null, null);
      MailServices.compose.OpenComposeWindowWithURI(null, aURI);
    } catch (x) { log.error(x); }
  },

  quitApplication: function() {
    try {
      icetray.Handler.timers['quit-application'] =
        icetray.Utils.timer(ICETRAY_DELAY_NOWAIT_MILLISECONDS,
          Ci.nsITimer.TYPE_ONE_SHOT, function() {
            let appStartup = Cc['@mozilla.org/toolkit/app-startup;1']
                  .getService(Ci.nsIAppStartup);
            appStartup.quit(Ci.nsIAppStartup.eAttemptQuit);
          });
    } catch (x) { log.error(x); }
  },

  prefsDisable: [
    {cond: function(){return icetray.Handler.inBrowserApp;},
     branch: "browser.tabs.", pref: "warnOnClose", bak:null},
    {cond: function(){return icetray.Handler.inMailApp;},
     branch: "mail.biff.", pref: "show_tray_icon", bak:null}
  ],
  disablePrefsTmp: function() {
    this.prefsDisable.forEach(function(pref){
      if (!pref.cond()) return;
      try {
        let branch = Services.prefs.getBranch(pref.branch);
        pref.bak = branch.getBoolPref(pref.pref);
        log.debug(pref.pref+" saved. was: "+pref.bak);
        branch.setBoolPref(pref.pref, false);
      } catch(x) {}
    });
  },
  restorePrefsTmp: function() {
    this.prefsDisable.forEach(function(pref){
      if (!pref.cond() || !pref.bak) return;
      let branch = Services.prefs.getBranch(pref.branch);
      branch.setBoolPref(pref.pref, pref.bak);
      log.debug(pref.pref+" restored to: "+pref.bak);
    });
  },

  excludeOtherShowIconPrefs: function(prefName) {
    if (prefName !== 'nomail_hides_icon')
      icetray.Utils.prefService.setBoolPref('nomail_hides_icon', false);
    if (prefName !== 'show_icon_on_hide')
      icetray.Utils.prefService.setBoolPref('show_icon_on_hide', false);
  }

}; // icetray.Handler


// FIXME: since prefs can also be changed from config editor, we need to
// 1. observe *all* icetray prefs, and 2. change options' UI accordingly !
icetray.PrefListener = new PrefListener(
  ICETRAY_PREF_BRANCH,
  function(branch, name) {
    log.debug('____Pref changed: '+name);
    switch (name) {
    case 'hides_single_window':
      icetray.Handler.showHidePopupMenuItems();
      break;
    case 'show_icon_on_hide':
      if (icetray.Utils.prefService.getBoolPref(name))
        icetray.Handler.excludeOtherShowIconPrefs(name);
      icetray.Handler.showHideIcon();
      break;
    case 'mail_notification_enabled':
      if (icetray.Utils.prefService.getBoolPref('mail_notification_enabled')) {
        icetray.Messaging.init();
        icetray.Messaging.updateMsgCountWithCb();
      } else {
        icetray.Messaging.shutdown();
        icetray.Handler.setIconImageDefault();
      }
      break;
    case 'mail_notification_type':
    case 'icon_text_color':
      icetray.Messaging.updateIcon();
      break;
    case 'new_mail_icon_names':
      icetray.Handler.loadIcons();
    case 'excluded_folders_flags':
    case 'folder_count_recursive':
    case 'mail_accounts':
    case 'message_count_type':
    case 'only_favorite_folders':
      icetray.Messaging.updateMsgCountWithCb();
      break;
    case 'nomail_hides_icon':
      if (icetray.Utils.prefService.getBoolPref(name))
        icetray.Handler.excludeOtherShowIconPrefs(name);
      else
        icetray.Handler.setIconVisibility(true);
      icetray.Messaging.updateMsgCountWithCb();
      break;
    case 'app_mail_icon_names':
    case 'app_browser_icon_names':
    case 'app_default_icon_names':
      icetray.Handler.loadIcons(); // linux
    case 'app_icon_custom':
    case 'mail_icon_custom':
      icetray.Handler.loadImageCustom(name); // winnt
      icetray.Handler.setIconImageCustom(name);
    case 'app_icon_type':
      icetray.Handler.setIconImageDefault();
      if (icetray.Handler.inMailApp)
        icetray.Messaging.updateMsgCountWithCb();
      break;

    case 'chat_icon_enable':
      icetray.Handler.toggleChat(icetray.Handler.isChatEnabled());
      break;

    case 'chat_icon_blink':
      if (!icetray.ChatStatusIcon.isBlinking)
        return;
      let startBlinking = icetray.Utils.prefService.getBoolPref('chat_icon_blink');
      if (startBlinking) {
        icetray.Chat.startGetAttention();
      } else {
        icetray.Chat.stopGetAttention();
      }
      break;

    case 'chat_icon_blink_style':
      if (!icetray.Utils.prefService.getBoolPref('chat_icon_blink') ||
          !icetray.ChatStatusIcon.isBlinking)
        break;

      icetray.ChatStatusIcon.toggleBlinkStyle(
        icetray.Utils.prefService.getIntPref("chat_icon_blink_style"));
      break;

    default:
    }
  });

icetray.MailChatPrefListener = new PrefListener(
  "mail.chat.",
  function(branch, name) {
    log.debug('MailChat pref changed: '+name);
    switch (name) {
    case 'enabled':
      let enableChatCond =
            (icetray.Handler.appHasChat &&
             icetray.Utils.prefService.getBoolPref("chat_icon_enable") &&
             icetray.Handler.support['chat']);
      if (!enableChatCond) return;

      if (Services.prefs.getBoolPref("mail.chat.enabled")) {
        if (!icetray.Chat) {
          Cu.import("resource://icetray/IcetrayMessaging.jsm"); // needed for existsChatAccount
          Cu.import("resource://icetray/linux/IcetrayChat.jsm");
          icetray.Utils.addObservers(icetray.Handler, [
            "account-added", "account-removed"]);
        }
        if (icetray.Handler.existsChatAccount())
          icetray.Handler.toggleChat(true);

      } else {
        icetray.Handler.toggleChat(false);
      }
      break;
    default:
    }
  });

icetray.VersionChangeHandler = {

  openTab: function(url) {
    log.info("app.id="+icetray.Handler.app.id);
    if (icetray.Handler.app.id === ICETRAY_APP_DB['icedoveuxp']['id'])
      this.openMailTab(url);

    else if (icetray.Handler.app.id === ICETRAY_APP_DB['iceweaseluxp']['id'] ||
             icetray.Handler.app.id === ICETRAY_APP_DB['iceapeuxp']['id'])
      this.openBrowserTab(url);

    else {
      this.openSystemBrowser(url);
    }
  },

  openMailTab: function(url) {
    let mail3PaneWindow = Services.wm.getMostRecentWindow("mail:3pane");
    if (mail3PaneWindow) {
      var tabmail = mail3PaneWindow.document.getElementById("tabmail");
      mail3PaneWindow.focus();
    }

    if (tabmail) {
      icetray.Handler.timers['open-mail-tab'] =
        icetray.Utils.timer(ICETRAY_DELAY_STARTUP_MILLISECONDS,
          Ci.nsITimer.TYPE_ONE_SHOT, function() {
            log.debug("openMailTab");
            tabmail.openTab("contentTab", {contentPage: url});
          });
    }
  },

  openBrowserTab: function(url) {
    let win = Services.wm.getMostRecentWindow("navigator:browser");
    log.debug("WIN="+win);
    if (win) {
      var mainWindow = win.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
            .getInterface(Components.interfaces.nsIWebNavigation)
            .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
            .rootTreeItem
            .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
            .getInterface(Components.interfaces.nsIDOMWindow);

      mainWindow.setTimeout(function(win){
        log.debug("openBrowser");
        mainWindow.gBrowser.selectedTab = mainWindow.gBrowser.addTab(url);
      }, 1000);
    }
  },

  openSystemBrowser: function(url) {
    log.debug("openSystemBrowser");
    try {
      var uri = Services.io.newURI(url, null, null);
      var handler = Cc['@mozilla.org/uriloader/external-protocol-service;1']
            .getService(Ci.nsIExternalProtocolService)
            .getProtocolHandlerInfo('http');
      handler.preferredAction = Ci.nsIHandlerInfo.useSystemDefault;
      handler.launchWithURI(uri, null);
    } catch (e) {log.error(e);}
  },

  deleteOrRenameOldOptions: function() {
    let v0_3_Opts = [
      "close_to_tray", "minimize_to_tray", "start_minimized", "confirm_exit",
      "restore_to_next_unread", "mail_count_type", "show_mail_count",
      "dont_count_spam", "dont_count_archive", "dont_count_drafts",
      "dont_count_sent", "dont_count_templates", "show_mail_notification",
      "show_icon_only_minimized", "use_custom_normal_icon",
      "use_custom_special_icon", "custom_normal_icon", "custom_special_icon",
      "text_color", "scroll_to_hide", "scroll_action", "grab_multimedia_keys",
      "hide_show_mm_key", "accounts_to_exclude" ];
    let v0_4_0b2_Opts = [ 'mail_notification' ];
    let oldOpts = v0_3_Opts.concat(v0_4_0b2_Opts);

    for (let i=0, len=oldOpts.length; i<len; ++i) {
      try {
        let option = oldOpts[i];
        icetray.Utils.prefService.clearUserPref(option);
      } catch (x) {}
    }

    let v0_5_0b1_Renames = {
      'mail_urgency_hint': 'mail_get_attention',
      'app_icon_filename': 'app_icon_custom',
      'custom_mail_icon': 'mail_icon_custom'
    };
    oldOpts = v0_5_0b1_Renames;

    let prefSrv = icetray.Utils.prefService;
    for (let opt in oldOpts) {
      log.debug("opt rename: "+opt);
      if (prefSrv.prefHasUserValue(opt)) {
        let prefType = prefSrv.getPrefType(opt);
        switch (prefType) {
        case Ci.nsIPrefBranch.PREF_STRING:
          prefSrv.setCharPref(oldOpts[opt], prefSrv.getCharPref(opt));
          break;
        case Ci.nsIPrefBranch.PREF_INT:
          prefSrv.setIntPref(oldOpts[opt], prefSrv.getIntPref(opt));
          break;
        case Ci.nsIPrefBranch.PREF_BOOL:
          prefSrv.setBoolPref(oldOpts[opt], prefSrv.getBoolPref(opt));
          break;
        default:
          log.error("Unknow pref type: "+prefType);
        }
      }
      try { prefSrv.clearUserPref(opt); } catch (x) {}
    }
  },

  correctMailNotificationType: function() {
    let msgCountType = icetray.Utils.prefService.getIntPref('message_count_type');
    let mailNotificationType = icetray.Utils.prefService.getIntPref('mail_notification_type');
    if (msgCountType === ICETRAY_MESSAGE_COUNT_TYPE_NEW &&
        mailNotificationType === ICETRAY_NOTIFICATION_MESSAGE_COUNT) {
      icetray.Utils.prefService.setIntPref('mail_notification_type',
        ICETRAY_NOTIFICATION_NEWMAIL_ICON);
      log.warn("mail notification type set to newmail icon.");
    }
  },

  correctMailServerTypes: function() {
    let mailAccounts = icetray.Utils.getObjPref('mail_accounts');
    let serverTypes = mailAccounts["serverTypes"];
    if (!serverTypes["exquilla"]) {
      serverTypes["exquilla"] = {"order":6,"excluded":true};
      let prefObj = {"serverTypes":serverTypes, "excludedAccounts":mailAccounts["excludedAccounts"]};
      icetray.Utils.setObjPref('mail_accounts', prefObj);
      log.warn("mail server types corrected");
    }
  }

};
