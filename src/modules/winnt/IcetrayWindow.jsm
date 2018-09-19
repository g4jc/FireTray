/* -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

var EXPORTED_SYMBOLS = [ "icetray" ];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://icetray/ctypes/ctypesMap.jsm");
Cu.import("resource://icetray/ctypes/winnt/kernel32.jsm");
Cu.import("resource://icetray/ctypes/winnt/user32.jsm");
Cu.import("resource://icetray/ctypes/winnt/win32.jsm");
Cu.import("resource://icetray/winnt/IcetrayWin32.jsm");
Cu.import("resource://icetray/IcetrayWindow.jsm");
Cu.import("resource://icetray/commons.js");
icetray.Handler.subscribeLibsForClosing([user32, kernel32]);

let log = icetray.Logging.getLogger("icetray.Window");

if ("undefined" == typeof(icetray.Handler))
  log.error("This module MUST be imported from/after IcetrayHandler !");

const ICETRAY_XWINDOW_HIDDEN    = 1 << 0; // when minimized also
const ICETRAY_XWINDOW_MAXIMIZED = 1 << 1;

// We need to keep long-living references to wndProcs callbacks. As they also
// happen to be ctypes pointers, we store them into real ctypes arrays.
icetray.Handler.wndProcs        = new ctypesMap(win32.LONG_PTR);
icetray.Handler.wndProcsOrig    = new ctypesMap(win32.LONG_PTR);
icetray.Handler.wndProcsStartup = new ctypesMap(win32.LONG_PTR);


icetray.Window = new IcetrayWindow();

icetray.Window.init = function() {
    this.initialized = true;
  };

icetray.Window.shutdown = function() {
  this.initialized = false;
};

icetray.Window.getVisibility = function(wid) {
  let hwnd = icetray.Win32.hexStrToHwnd(wid);
  let style = user32.GetWindowLongW(hwnd, user32.GWL_STYLE);
  return ((style & user32.WS_VISIBLE) != 0); // user32.IsWindowVisible(hwnd);
};

// icetray.Window.{show,hide} useless as we don't need to restore position and size
icetray.Window.setVisibility = function(wid, visible) {
  log.debug("setVisibility="+visible);
  let hwnd = icetray.Win32.hexStrToHwnd(wid);
  let ret = user32.ShowWindow(hwnd, visible ? user32.SW_SHOW : user32.SW_HIDE);
  log.debug("  ShowWindow="+ret+" winLastError="+ctypes.winLastError);
  if (visible) user32.SetForegroundWindow(hwnd);
};

icetray.Window.wndProc = function(hWnd, uMsg, wParam, lParam) { // filterWindow
  // log.debug("wndProc CALLED: hWnd="+hWnd+", uMsg=0x"+uMsg.toString(16)+", wParam="+wParam+", lParam="+lParam);
  let wid = icetray.Win32.hwndToHexStr(hWnd);

  if (uMsg === win32.WM_SYSCOMMAND) {
    log.debug("wndProc CALLED with WM_SYSCOMMAND wParam="+wParam);
    if (wParam === win32.SC_MINIMIZE) {
      log.debug("GOT ICONIFIED");
      if (icetray.Handler.onMinimize(wid)) {
        return 0;               // processed => preventDefault
      }
    }
  }

  let procPrev = icetray.Handler.wndProcsOrig.get(wid);
  return user32.CallWindowProcW(
    user32.WNDPROC(procPrev), hWnd, uMsg, wParam, lParam); // or DefWindowProcW
};

/*
 * For start_hidden, we get the best effect by intercepting
 * WM_WINDOWPOSCHANGING/SWP_SHOWWINDOW.
 * Here, we subclass only once either with a startup wndProc, if
 * start_hidden, or just our default wndProc. None of the following works:
 * - a WH_CALLWNDPROC hook doesn't catch SWP_SHOWWINDOW
 * - chaining WNDPROCs crashes the app (UserCallWinProcCheckWow or ffi_call)
 */
icetray.Window.wndProcStartup = function(hWnd, uMsg, wParam, lParam) {
  let wid = icetray.Win32.hwndToHexStr(hWnd);

  if (uMsg === win32.WM_WINDOWPOSCHANGING) {
    let posStruct = ctypes.cast(win32.LPARAM(lParam),
                                user32.WINDOWPOS.ptr).contents;

    let isShowing = ((posStruct.flags & user32.SWP_SHOWWINDOW) != 0);
    if (isShowing) {
      log.debug("wndProcStartup CALLED with WM_WINDOWPOSCHANGING/SWP_SHOWWINDOW");
      icetray.Window.startup.showCount += 1;

      if (icetray.Window.startup.showCount < 2) {  // hide
        log.debug("start_hidden");
        // Modifying posStruct is modifying lParam, which is passed onwards!
        if (icetray.Window.startup.showSpecial) {
          posStruct.flags &= user32.SWP_NOSIZE|user32.SWP_NOMOVE;
        }
        else {
          posStruct.flags &= ~user32.SWP_SHOWWINDOW;
        }
        let force = true;
        icetray.Handler.addPopupMenuWindowItemAndSeparatorMaybe(wid, force);
      }
      else {                    // restore
        icetray.Window.attachWndProc({
          wid: wid, hwnd: hWnd,
          jsProc: icetray.Window.wndProc,
          mapNew: icetray.Handler.wndProcs,
          mapBak: null
        });
        icetray.Handler.wndProcsStartup.remove(wid);

        if (icetray.Window.startup.showSpecial) {
          let placement = new user32.WINDOWPLACEMENT;
          let ret = user32.GetWindowPlacement(hWnd, placement.address());
          icetray.js.assert(ret, "GetWindowPlacement failed.");
          placement.showCmd = icetray.Window.startup.showSpecial;
          user32.SetWindowPlacement(hWnd, placement.address());
        }
      }
    }

  }

  let procPrev = icetray.Handler.wndProcsOrig.get(wid);
  return user32.CallWindowProcW(user32.WNDPROC(procPrev), hWnd, uMsg, wParam, lParam);
};

// procInfo = {wid, hwnd, jsProc, mapNew, mapBak}
icetray.Window.attachWndProc = function(procInfo) {
  try {
    let wndProc = ctypes.cast(user32.WNDPROC(procInfo.jsProc), win32.LONG_PTR);
    log.debug("proc="+wndProc);
    procInfo.mapNew.insert(procInfo.wid, wndProc);
    let procPrev = user32.SetWindowLongW(procInfo.hwnd, user32.GWLP_WNDPROC, wndProc);
    log.debug("procPrev="+procPrev+" winLastError="+ctypes.winLastError);
    /* we can't store WNDPROC callbacks (JS ctypes objects) with SetPropW(), as
     we need long-living refs. */
    if (procInfo.mapBak) procInfo.mapBak.insert(procInfo.wid, procPrev);

  } catch (x) {
    if (x.name === "RangeError") { // instanceof not working :-(
      let msg = x+"\n\nYou seem to have more than "+ICETRAY_WINDOW_COUNT_MAX
                +" windows open. This breaks FireTray and most probably "
                +icetray.Handler.app.name+".";
      log.error(msg);
      Cu.reportError(msg);
    }else {
      log.error(x);
      Cu.reportError(x);
    }
  }
};

// procInfo = {wid, mapNew, mapBak}
icetray.Window.detachWndProc = function(procInfo) {
  let wid = procInfo.wid;
  let procBak = procInfo.mapBak.get(wid);
  let procNew = procInfo.mapNew.get(wid);
  let hwnd = icetray.Win32.hexStrToHwnd(wid);
  log.debug("hwnd="+hwnd);
  let procPrev = user32.SetWindowLongW(hwnd, user32.GWLP_WNDPROC, procBak);
  icetray.js.assert(icetray.js.strEquals(procPrev, procNew),
                     "Wrong WndProc replaced.");
  procInfo.mapNew.remove(wid);
  procInfo.mapBak.remove(wid);
};


///////////////////////// icetray.Handler overriding /////////////////////////

/** debug facility */
icetray.Handler.dumpWindows = function() {
  let dumpStr = ""+icetray.Handler.windowsCount;
  for (let wid in icetray.Handler.windows) {
    dumpStr += " "+wid;
  }
  log.info(dumpStr);
};

icetray.Handler.registerWindow = function(win) {
  log.debug("register window");

  let baseWin = icetray.Handler.getWindowInterface(win, "nsIBaseWindow");
  let wid = baseWin.nativeHandle;
  if (!wid) {
    log.error("nativeHandle undefined ?!");
    return false;
  }
  let hwnd = icetray.Win32.hexStrToHwnd(wid);
  log.debug("=== hwnd="+hwnd+" wid="+wid+" win.document.title: "+win.document.title);

  if (this.windows.hasOwnProperty(wid)) {
    let msg = "Window ("+wid+") already registered.";
    log.error(msg);
    Cu.reportError(msg);
    return false;
  }
  this.windows[wid] = {};
  this.windows[wid].chromeWin = win;
  this.windows[wid].baseWin = baseWin;
  Object.defineProperties(this.windows[wid], {
    "visible": { get: function(){return icetray.Window.getVisibility(wid);} }
  });
  log.debug("window "+wid+" registered");

  let proc, map;
  if (!icetray.Handler.appStarted &&
      icetray.Utils.prefService.getBoolPref('start_hidden')) {
    let startupInfo = new kernel32.STARTUPINFO;
    kernel32.GetStartupInfoW(startupInfo.address());
    let showSpecial = ([
      user32.SW_SHOWMINNOACTIVE, user32.SW_SHOWMINIMIZED,
      user32.SW_SHOWMAXIMIZED
    ].indexOf(startupInfo.wShowWindow) > -1) ? startupInfo.wShowWindow : 0;
    icetray.Window.startup = {showCount: 0, showSpecial: showSpecial};
    proc = icetray.Window.wndProcStartup; map = icetray.Handler.wndProcsStartup;
  } else {
    proc = icetray.Window.wndProc; map = icetray.Handler.wndProcs;
  }
  icetray.Window.attachWndProc({
    wid: wid, hwnd: hwnd,
    jsProc: proc,
    mapNew: map,
    mapBak: icetray.Handler.wndProcsOrig
  });

  icetray.Win32.acceptAllMessages(hwnd);

  log.debug("AFTER"); icetray.Handler.dumpWindows();
  return wid;
};

icetray.Handler.unregisterWindow = function(win) {
  log.debug("unregister window");

  let wid = icetray.Window.getRegisteredWinIdFromChromeWindow(win);
  if (!icetray.Handler.windows.hasOwnProperty(wid)) {
    log.error("can't unregister unknown window "+wid);
    return false;
  }

  let mapNew;
  try {
    icetray.Handler.wndProcsStartup.get(wid); // throws
    mapNew = icetray.Handler.wndProcsStartup;
    log.debug("Window never shown (unregistered but procStartup still in place).");
  } catch (x) {
    if (x.name === "RangeError") {
      mapNew = icetray.Handler.wndProcs;
    } else {
      log.error(x);
      Cu.reportError(x);
    }
  }
  icetray.Window.detachWndProc({
    wid: wid, mapNew: mapNew, mapBak: icetray.Handler.wndProcsOrig
  });

  if (!delete icetray.Handler.windows[wid])
    throw new DeleteError();

  icetray.Handler.dumpWindows();
  log.debug("window "+wid+" unregistered");
  return true;
};

icetray.Handler.showWindow = function(wid) {
  icetray.Handler.removePopupMenuWindowItemAndSeparatorMaybe(wid);
  return icetray.Window.setVisibility(wid, true);
};
icetray.Handler.hideWindow = function(wid) {
  icetray.Handler.addPopupMenuWindowItemAndSeparatorMaybe(wid);
  return icetray.Window.setVisibility(wid, false);
};

icetray.Handler.windowGetAttention = function(wid) { // see nsWindow.cpp
  for (var first in this.windows) break;
  wid = wid || first;
  let hwnd = icetray.Win32.hexStrToHwnd(wid);
  let fgWnd = user32.GetForegroundWindow();
  log.debug(hwnd+" === "+fgWnd);
  if (icetray.js.strEquals(hwnd, fgWnd) ||
      !this.windows[wid].visible)
    return;

  let defaultCycleCount = new win32.DWORD;
  user32.SystemParametersInfoW(user32.SPI_GETFOREGROUNDFLASHCOUNT, 0,
                               defaultCycleCount.address(), 0);
  log.debug("defaultCycleCount="+defaultCycleCount);

  let flashInfo = new user32.FLASHWINFO;
  flashInfo.cbSize = user32.FLASHWINFO.size;
  flashInfo.hwnd = hwnd;
  flashInfo.dwFlags = user32.FLASHW_ALL;
  flashInfo.uCount = defaultCycleCount;
  flashInfo.dwTimeout = 0;
  user32.FlashWindowEx(flashInfo.address());
};
