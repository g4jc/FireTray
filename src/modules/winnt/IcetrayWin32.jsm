/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

var EXPORTED_SYMBOLS = [ "icetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://icetray/ctypes/winnt/win32.jsm");
Cu.import("resource://icetray/ctypes/winnt/kernel32.jsm");
Cu.import("resource://icetray/ctypes/winnt/user32.jsm");
Cu.import("resource://icetray/commons.js");
icetray.Handler.subscribeLibsForClosing([kernel32, user32]);

let log = icetray.Logging.getLogger("icetray.Win32");

const kMessageTray     = "_ICETRAY_Tray";

if ("undefined" == typeof(icetray.Handler))
  log.error("This module MUST be imported from/after IcetrayHandler !");


function Win32Env() {

  this.hInstance = kernel32.GetModuleHandleW("xul"); // ordinary windows are created from xul.dll
  log.debug("hInstance="+this.hInstance);

  // we use our own messages because we create a different window class than Moz
  this.WM_TASKBARCREATED = user32.RegisterWindowMessageW("TaskbarCreated");
  this.WM_TRAYMESSAGE    = user32.RegisterWindowMessageW(kMessageTray);
  log.debug("WM_*="+this.WM_TASKBARCREATED+" "+this.WM_TRAYMESSAGE+" "+this.WM_TRAYCALLBACK);

  /* if Administrator, accept messages from applications running in a lower
   privilege level */
  this.acceptAllMessages = function(hwnd) {
    let rv = null;
    log.debug(win32.WINVER+" >= "+win32.WIN_VERSIONS["7"]);
    if (win32.WINVER >= win32.WIN_VERSIONS["7"]) {
      rv = user32.ChangeWindowMessageFilterEx(hwnd, icetray.Win32.WM_TASKBARCREATED, user32.MSGFLT_ALLOW, null);
      log.debug("ChangeWindowMessageFilterEx res="+rv+" winLastError="+ctypes.winLastError);
    } else if (win32.WINVER >= win32.WINVER["Vista"]) {
      rv = user32.ChangeWindowMessageFilter(icetray.Win32.WM_TASKBARCREATED, user32.MSGFLT_ADD);
      log.debug("ChangeWindowMessageFilter res="+rv+" winLastError="+ctypes.winLastError);
    } else {
        // no UIPI
    }
    return rv;
  };

  // wid will be used as a string most of the time (through f.Handler.windows mainly)
  this.hwndToHexStr = function(hWnd) {
    return "0x" + ctypes.cast(hWnd, ctypes.uintptr_t).value.toString(16);
  };
  this.hexStrToHwnd = function(wid) {
    return win32.HWND(ctypes.UInt64(wid));
  };

}

icetray.Win32 = new Win32Env();
