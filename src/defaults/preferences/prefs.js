// https://developer.mozilla.org/en/Localizing_extension_descriptions
pref("extensions.{9533f794-00b4-4354-aa15-c2bbda6989f8}.description", "chrome://icetray/locale/overlay.properties");

// Extension prefs
pref("extensions.icetray.firstrun", true);

pref("extensions.icetray.hides_on_close", true);
pref("extensions.icetray.hides_on_minimize", true);
pref("extensions.icetray.hides_single_window", true);
pref("extensions.icetray.hides_last_only", false);
pref("extensions.icetray.start_hidden", false);
pref("extensions.icetray.show_activates", false);
pref("extensions.icetray.remember_desktop", false);

pref("extensions.icetray.app_icon_type", 0);
pref("extensions.icetray.app_browser_icon_names", '["web-browser", "internet-web-browser"]');
pref("extensions.icetray.app_mail_icon_names", '["indicator-messages", "applications-email-panel"]');
pref("extensions.icetray.app_default_icon_names", '[]');
pref("extensions.icetray.app_icon_custom", "");
pref("extensions.icetray.new_mail_icon_names", '["indicator-messages-new", "mail-message-new"]');
pref("extensions.icetray.show_icon_on_hide", false);
pref("extensions.icetray.scroll_hides", true);
pref("extensions.icetray.scroll_mode", "down_hides");
pref("extensions.icetray.middle_click", 0);
pref("extensions.icetray.chat_icon_enable", true);
pref("extensions.icetray.chat_icon_blink", true);
pref("extensions.icetray.chat_icon_blink_style", 0);

pref("extensions.icetray.mail_get_attention", true);
pref("extensions.icetray.nomail_hides_icon", false);
pref("extensions.icetray.message_count_type", 0);
pref("extensions.icetray.mail_notification_enabled", true);
pref("extensions.icetray.mail_notification_type", 0);
pref("extensions.icetray.icon_text_color", "#000000");
pref("extensions.icetray.mail_icon_custom", "");
pref("extensions.icetray.mail_change_trigger", "");
pref("extensions.icetray.folder_count_recursive", true);
// Ci.nsMsgFolderFlags.Archive|Drafts|Junk|Queue|SentMail|Trash|Virtual
pref("extensions.icetray.excluded_folders_flags", 1077956384);
// exposed in 1 tree, hence 2 branches: serverTypes, excludedAccounts
pref("extensions.icetray.mail_accounts", '{ "serverTypes": {"pop3":{"order":1,"excluded":false}, "imap":{"order":1,"excluded":false}, "movemail":{"order":2,"excluded":true}, "none":{"order":3,"excluded":false}, "rss":{"order":4,"excluded":true}, "nntp":{"order":5,"excluded":true}, "exquilla":{"order":6,"excluded":true}}, "excludedAccounts": [] }'); // JSON
pref("extensions.icetray.only_favorite_folders", false);

pref("extensions.icetray.with_appindicator", true);
