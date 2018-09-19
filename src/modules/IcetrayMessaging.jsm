/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

var EXPORTED_SYMBOLS = [ "icetray", "FLDRS_UNINTERESTING" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource:///modules/iteratorUtils.jsm");
Cu.import("resource:///modules/mailServices.js");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/PluralForm.jsm");
Cu.import("resource://icetray/commons.js");

const FLDRS_UNINTERESTING = {
  Archive:   Ci.nsMsgFolderFlags.Archive,   // 0x00004000
  Drafts:    Ci.nsMsgFolderFlags.Drafts,    // 0x00000400
  Junk:      Ci.nsMsgFolderFlags.Junk,      // 0x40000000
  Queue:     Ci.nsMsgFolderFlags.Queue,     // 0x00000800
  SentMail:  Ci.nsMsgFolderFlags.SentMail,  // 0x00000200
  Templates: Ci.nsMsgFolderFlags.Templates, // 0x00400000
  Trash:     Ci.nsMsgFolderFlags.Trash,     // 0x00000100
  Virtual:   Ci.nsMsgFolderFlags.Virtual    // 0x00000020
};

const ACCOUNTS_PREF_BRANCH = "mail.accountmanager.accounts";

let log = icetray.Logging.getLogger("icetray.Messaging");


icetray.Messaging = {
  initialized: false,
  currentMsgCount: null,
  newMsgCount: null,

  init: function() {
    if (this.initialized) {
      log.warn("Messaging already initialized");
      return;
    }
    log.debug("Enabling Messaging");

    /* addPrefObserver() called after appStarted because it's hazardous to
     clean our excludedAccounts while mail.accountmanager.accounts is being
     built dynamically at startup */

    let that = this;
    MailServices.mailSession.AddFolderListener(that.mailSessionListener,
                                               that.mailSessionListener.notificationFlags);

    this.initialized = true;
  },

  shutdown: function() {
    if (!this.initialized) return;
    log.debug("Disabling Messaging");

    MailServices.mailSession.RemoveFolderListener(this.mailSessionListener);

    this.removePrefObserver();

    this.initialized = false;
  },

  addPrefObserver: function() {
    // includes IM accounts
    Services.prefs.addObserver(ACCOUNTS_PREF_BRANCH, this, false);
    log.debug("PrefObserver added");
  },
  removePrefObserver: function() {
    Services.prefs.removeObserver(ACCOUNTS_PREF_BRANCH, this);
  },

  /* could also use a PrefListener, but let's keep it simple for now */
  observe: function(subject, topic, data) {
    if (topic === "nsPref:changed" && data === ACCOUNTS_PREF_BRANCH) {
      log.debug(ACCOUNTS_PREF_BRANCH+"="+subject.QueryInterface(Ci.nsIPrefBranch).getCharPref(ACCOUNTS_PREF_BRANCH));
      this.cleanExcludedAccounts();
    }
  },

  /* removes removed accounts from excludedAccounts pref. NOTE: Can't be called
    at shutdown because MailServices.accounts no longer available */
  cleanExcludedAccounts: function() {
    log.info("* cleaning *");
    let mailAccounts = icetray.Utils.getObjPref('mail_accounts');
    let excludedAccounts = mailAccounts["excludedAccounts"];

    // build current list of account server keys
    let accounts = MailServices.accounts.accounts;
    let accountServerKeys = [];
    for (let account in fixIterator(MailServices.accounts, Ci.nsIMsgAccount)) {
      accountServerKeys.push(account.incomingServer.key);
    }

    let newExcludedAccounts = [], cleaningNeeded = 0;
    for (let i=0, len=excludedAccounts.length; i<len; ++i) {
      let excludedAccount = excludedAccounts[i];
      if (accountServerKeys.indexOf(excludedAccount) >= 0)
        newExcludedAccounts.push(excludedAccount);
      else
        cleaningNeeded += 1;
    }

    if (cleaningNeeded) {
      log.debug("cleaning excluded accounts");
      let prefObj = {"serverTypes":mailAccounts["serverTypes"], "excludedAccounts":newExcludedAccounts};
      icetray.Utils.setObjPref('mail_accounts', prefObj);
    }
  },

  // https://bugzilla.mozilla.org/show_bug.cgi?id=715799 for TB15+
  // mozINewMailNotificationService (alternative message counting)
  /* http://mxr.mozilla.org/comm-central/source/mailnews/base/public/nsIFolderListener.idl */
  mailSessionListener: {
    notificationFlags:
      // Ci.nsIFolderListener.propertyChanged |
      Ci.nsIFolderListener.propertyFlagChanged |
      // Ci.nsIFolderListener.event |
      Ci.nsIFolderListener.boolPropertyChanged |
      Ci.nsIFolderListener.intPropertyChanged,

    OnItemPropertyChanged: function(item, property, oldValue, newValue) { // NumNewBiffMessages
      log.debug("OnItemPropertyChanged "+property+" for folder "+item.prettyName+" was "+oldValue+" became "+newValue+" NEW MESSAGES="+item.getNumNewMessages(true));
    },

    OnItemIntPropertyChanged: function(item, property, oldValue, newValue) { // TotalUnreadMessages, BiffState (per server)
      log.debug("OnItemIntPropertyChanged "+property+" for folder "+item.prettyName+" was "+oldValue+" became "+newValue+" NEW MESSAGES="+item.getNumNewMessages(true));
      this.onMsgCountChange(item, property, oldValue, newValue);
    },

    OnItemBoolPropertyChanged: function(item, property, oldValue, newValue) { // NewMessages (per folder)
      log.debug("OnItemBoolPropertyChanged "+property+" for folder "+item.prettyName+" was "+oldValue+" became "+newValue+" NEW MESSAGES="+item.getNumNewMessages(true));
      this.onMsgCountChange(item, property, oldValue, newValue);
    },

    OnItemPropertyFlagChanged: function(item, property, oldFlag, newFlag) {
      log.debug("OnItemPropertyFlagChanged"+property+" for "+item+" was "+oldFlag+" became "+newFlag);
      this.onMsgCountChange(item, property, oldFlag, newFlag);
    },

    OnItemEvent: function(item, event) {
      log.debug("OnItemEvent "+event+" for folder "+item.prettyName);
    },

    onMsgCountChange: function(item, property, oldValue, newValue) {
      let excludedFoldersFlags = icetray.Utils.prefService.getIntPref("excluded_folders_flags");
      let onlyFavorites = icetray.Utils.prefService.getBoolPref("only_favorite_folders");
      let msgCountType = icetray.Utils.prefService.getIntPref("message_count_type");

      if (!(item.flags & excludedFoldersFlags)) {
        let prop = property.toString();
        if (prop === "FolderFlag" && onlyFavorites) {
          if ((oldValue ^ newValue) & Ci.nsMsgFolderFlags.Favorite)
            icetray.Messaging.updateMsgCountWithCb();
        } else if (prop === "TotalUnreadMessages" &&
                   msgCountType === ICETRAY_MESSAGE_COUNT_TYPE_UNREAD) {
          icetray.Messaging.updateMsgCountWithCb();
        } else if (prop === "NewMessages" &&
                   msgCountType === ICETRAY_MESSAGE_COUNT_TYPE_NEW) {
          if (oldValue === true && newValue === false)
            item.setNumNewMessages(0); // https://bugzilla.mozilla.org/show_bug.cgi?id=727460
          icetray.Messaging.updateMsgCountWithCb();
        }
      }
    }
  },

  /**
   * @param callback: optional callback to call when msgCount changed.
   */
  updateMsgCountWithCb: function(callback) {
    log.debug("updateMsgCountWithCb");
    if (!this.initialized) return;

    if ("undefined" === typeof(callback) || !callback)
      callback = function(currentMsgCount, newMsgCount) { // default
        icetray.Messaging.updateIcon(newMsgCount);

        if (newMsgCount !== currentMsgCount) {
          let mailChangeTriggerFile = icetray.Utils.prefService.getCharPref("mail_change_trigger");
          if (mailChangeTriggerFile)
            icetray.Messaging.runProcess(mailChangeTriggerFile, [newMsgCount.toString()]);

          let getAttention = icetray.Utils.prefService.getBoolPref("mail_get_attention");
          if (getAttention && (newMsgCount > currentMsgCount))
            for (let winId in icetray.Handler.windows)
              icetray.Handler.windowGetAttention(winId);
        }
      };

    let msgCountType = icetray.Utils.prefService.getIntPref("message_count_type");
    log.debug("msgCountType="+msgCountType);
    if (msgCountType === ICETRAY_MESSAGE_COUNT_TYPE_UNREAD) {
      this.countMessages("UnreadMessages");
    } else if (msgCountType === ICETRAY_MESSAGE_COUNT_TYPE_NEW) {
      this.countMessages("HasNewMessages");
    } else
      log.error('unknown message count type');

    /* currentMsgCount and newMsgCount may be integers or bool, which do
     also support comparaison operations */
    callback.call(this, this.currentMsgCount, this.newMsgCount);
    this.currentMsgCount = this.newMsgCount;
  },

  updateIcon: function(msgCount) {
    log.debug("updateIcon");
    if ("undefined" === typeof(msgCount)) msgCount = this.currentMsgCount;

    let localizedTooltip;
    let msgCountType = icetray.Utils.prefService.getIntPref("message_count_type");
    if (msgCountType === ICETRAY_MESSAGE_COUNT_TYPE_UNREAD) {
      localizedTooltip = PluralForm.get(
        msgCount,
        icetray.Utils.strings.GetStringFromName("tooltip.unread_messages"))
        .replace("#1", msgCount);
      log.debug(localizedTooltip);
    } else if (msgCountType === ICETRAY_MESSAGE_COUNT_TYPE_NEW) {
      localizedTooltip = icetray.Utils.strings.GetStringFromName("tooltip.new_messages");
    } else
      log.error('unknown message count type');

    if (msgCount == 0) {

      icetray.Handler.setIconImageDefault();
      icetray.Handler.setIconTooltipDefault();

    } else if (msgCount > 0) {
      let prefMailNotification = icetray.Utils.prefService.getIntPref('mail_notification_type');
      log.debug("msgCount prefMailNotification="+prefMailNotification);
      switch (prefMailNotification) {
      case ICETRAY_NOTIFICATION_MESSAGE_COUNT:
        let prefIconTextColor = icetray.Utils.prefService.getCharPref("icon_text_color");
        icetray.Handler.setIconText(msgCount.toString(), prefIconTextColor);
        break;
      case ICETRAY_NOTIFICATION_NEWMAIL_ICON:
        icetray.Handler.setIconImageNewMail();
        break;
      case ICETRAY_NOTIFICATION_CUSTOM_ICON:
        icetray.Handler.setIconImageCustom('mail_icon_custom');
        break;
      default:
        log.error("Unknown notification mode: "+prefMailNotification);
      }

      icetray.Handler.setIconTooltip(localizedTooltip);

    } else {
      throw "negative message count"; // should never happen
    }

    icetray.Handler.showHideIcon(msgCount);
  },

  /**
   * computes total unread or new message count.
   */
  countMessages: function(countType) {
    let mailAccounts = icetray.Utils.getObjPref('mail_accounts');
    log.debug("mail accounts from pref: "+JSON.stringify(mailAccounts));
    let serverTypes = mailAccounts["serverTypes"];
    let excludedAccounts = mailAccounts["excludedAccounts"];

    this.newMsgCount = 0;
    let accounts = new this.Accounts();
    for (let accountServer in accounts) { // nsIMsgIncomingServer

      if (accountServer.type === ICETRAY_ACCOUNT_SERVER_TYPE_IM) {
        continue;               // IM messages are counted elsewhere
      } else if (!serverTypes[accountServer.type]) {
        log.warn("'"+accountServer.type+"' server type is not handled");
        continue;
      }

      log.debug("is servertype excluded: "+serverTypes[accountServer.type].excluded+", account exclusion index: "+excludedAccounts.indexOf(accountServer.key));
      if ((serverTypes[accountServer.type].excluded) ||
          (excludedAccounts.indexOf(accountServer.key) >= 0))
        continue;

      this.applyToSubfolders(
        accountServer.rootFolder,
        icetray.Utils.prefService.getBoolPref("folder_count_recursive"),
        function(folder){this.msgCountIterate(countType, folder);}
      );

    }
    log.debug("Total "+countType+"="+this.newMsgCount);
  },

  /**
   * @param folder: a nsIMsgFolder
   * @param recursive: if we should look into nested folders
   * @param fun: a function to apply to all folders
   */
  applyToSubfolders: function(folder, recursive, fun) {
    if (folder.hasSubFolders) {
      let subFolders = folder.subFolders;
      while(subFolders.hasMoreElements()) {
        let subFolder = subFolders.getNext().QueryInterface(Ci.nsIMsgFolder);
        if (recursive && subFolder.hasSubFolders)
          icetray.Messaging.applyToSubfoldersRecursive(subFolder, recursive, fun);
        else
          fun.call(this, subFolder);
      }
    }
  },
  applyToSubfoldersRecursive: function(folder, recursive, fun) {
    fun.call(this, folder);
    this.applyToSubfolders(folder, recursive, fun);
  },

  /**
   * @param type: one of 'UnreadMessages', 'HasNewMessages'
   */
  msgCountIterate: function(type, folder) {
    let onlyFavorites = icetray.Utils.prefService.getBoolPref("only_favorite_folders");
    let excludedFoldersFlags = icetray.Utils.prefService.getIntPref("excluded_folders_flags");
    if (!(folder.flags & excludedFoldersFlags)) {
      if (!onlyFavorites || folder.flags & Ci.nsMsgFolderFlags.Favorite) {
        icetray.Messaging["add"+type](folder);
      }
    }
    log.debug("newMsgCount="+this.newMsgCount);
  },

  addUnreadMessages: function(folder) {
    let folderUnreadMsgCount = folder['getNumUnread'](false);
    log.debug("folder: "+folder.prettyName+" folderUnreadMsgCount="+folderUnreadMsgCount);
    /* nsMsgDBFolder::GetNumUnread basically returns mNumUnreadMessages +
      mNumPendingUnreadMessages, while mNumPendingUnreadMessages may get -1
      when updated from the cache. Which means getNumUnread might return -1. */
    if (folderUnreadMsgCount > 0)
      this.newMsgCount += folderUnreadMsgCount;
  },

  addHasNewMessages: function(folder) {
    let folderNewMsgCount = folder.hasNewMessages;
    log.debug("folder: "+folder.prettyName+" hasNewMessages="+folderNewMsgCount);
    this.newMsgCount = this.newMsgCount || folderNewMsgCount;
  },

  runProcess: function(filepath, args) {
    log.debug("runProcess="+filepath+" args="+args);
    try {
      // create a file for the process
      var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(filepath);

      // create the process
      var process = Cc["@mozilla.org/process/util;1"]
            .createInstance(Ci.nsIProcess);
      process.init(file);

      process.run(false, args, args.length);
    } catch(x) {log.error(x);}
  }

};


/**
 * Accounts Iterator/Generator for iterating over all account servers.
 * NOTE: MailServices.accounts.allServers excludes hidden and IM servers
 * @param sortByTypeAndName: boolean
 * @return a generator over all nsIMsgIncomingServer including hidden and IM ones
 */
icetray.Messaging.Accounts = function(sortByTypeAndName) {
  if (typeof(sortByTypeAndName) == "undefined") {
    this.sortByTypeAndName = false;
    return;
  }
  if (typeof(sortByTypeAndName) !== "boolean")
    throw new TypeError();

  this.sortByTypeAndName = sortByTypeAndName;
};

icetray.Messaging.Accounts.prototype.__iterator__ = function() {
  log.debug("sortByTypeAndName="+this.sortByTypeAndName);

  /* NOTE: sort() not provided by nsIMsgAccountManager.accounts
   (nsISupportsArray or nsIArray if xulrunner >= 20.0). Should be OK to
   re-build a JS-Array for few accounts */
  let accountServers = [];
  for (let accountServer in fixIterator(MailServices.accounts.accounts,
                                        Ci.nsIMsgAccount)) {
    accountServers.push(accountServer.incomingServer);
  }

  let mailAccounts = icetray.Utils.getObjPref('mail_accounts');
  let serverTypes = mailAccounts["serverTypes"];
  if (this.sortByTypeAndName) {
    accountServers.sort(function(a,b) {
      if (serverTypes[a.type].order
          < serverTypes[b.type].order)
        return -1;
      if (serverTypes[a.type].order
          > serverTypes[b.type].order)
        return 1;
      if (a.prettyName < b.prettyName)
        return -1;
      if (a.prettyName > b.prettyName)
        return 1;
      return 0; // no sorting
    });
  }

  for (let i=0, len=accountServers.length; i<len; ++i) {
    log.debug("ACCOUNT: "+accountServers[i].prettyName+" type: "+accountServers[i].type);
    yield accountServers[i];
  }
};

/**
 * return accounts grouped by mail_accounts.
 *
 * ex: { movemail: {"server1", "server2"}, imap: {"server3"} }
 */
icetray.Messaging.accountsByServerType = function() {
  let accountsByServerType = {};
  let accounts = new icetray.Messaging.Accounts(false);
  for (let accountServer in accounts) {
    let accountServerKey = accountServer.key.toString();
    let accountServerName = accountServer.prettyName;
    let accountServerType = accountServer.type;
    if (typeof(accountsByServerType[accountServerType]) == "undefined")
      accountsByServerType[accountServerType] = [];
    accountsByServerType[accountServerType].push(
      { key: accountServerKey, name: accountServerName });
  }
  return accountsByServerType;
};
