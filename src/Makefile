.PHONY: help
help:
	@echo "BUILD/INSTALL INSTRUCTIONS"
	@echo
	@echo "to build Moztray, just:"
	@echo "  make all"
	@echo
	@echo "by default, debug calls are stripped from js files and DEBUG_MODE"
	@echo "is off (performance). If you want to keep debug calls:"
	@echo "  DEBUG=on make all"
	@echo
	@echo "to create the dev profile:"
	@echo "  firefox -no-remote -P	# then create '$(profile_dir)'"
	@echo
	@echo "to deploy to dev profile:"
	@echo "  make clean"
	@echo "  make install"
	@echo
	@echo "to test with dev profile:"
	@echo "  firefox -no-remote -P mozilla-dev"
	@echo
	@echo "Have fun !"

# The UUID of the extension.
extension_uuid := moztray@foudil.fr

# The name of the profile dir where the extension can be installed.
profile_dir := mozilla-dev

# The zip application to be used.
ZIP := zip

# The target location of the build and build files.
build_dir := ../build

# The type of operating system this make command is running on.
# os_type := $(patsubst darwin%,darwin,$(shell echo $(OSTYPE)))
# we don't want to: export OSTYPE; make install
os_type := $(patsubst darwin%,darwin,$(shell echo $$OSTYPE))

# The location of the extension profile.
ifeq ($(os_type), darwin)
  profile_location := \
    ~/Library/Application\ Support/Firefox/Profiles/$(profile_dir)/extensions
else
  ifeq ($(os_type), linux-gnu)
    profile_location := \
      ~/.mozilla/firefox/$(profile_dir)/extensions
  else
    profile_location := \
      "$(subst \,\\,$(APPDATA))\\Mozilla\\Firefox\\Profiles\\$(profile_dir)\\extensions"
  endif
endif

# The license file
license := LICENSE

# The install.rdf file.
install_rdf := install.rdf

# Version fetched from install.rdf
VERSION := $(shell awk '/<em:version>/ {  version=$$1; \
  version=gensub(/<em:version>(.+)<\/em:version>/, "\\1", "g", version); \
  print version }' $(install_rdf))

# The target XPI files.
xpi_file := $(extension_uuid)-$(VERSION).xpi
xpi_built := $(build_dir)/$(xpi_file)
# Since we use <em:unpack>false, we need the same name across versions
xpi_deployed := $(extension_uuid).xpi

# The chrome.manifest file.
chrome_manifest := chrome.manifest

# The preferences dir.
preferences_dir := defaults/preferences

# The root of the chrome sources.
chrome_source_root := chrome

# The chrome sources.
chrome_sources_js := $(wildcard $(chrome_source_root)/content/*.js)
chrome_sources := $(chrome_sources_js) \
               $(wildcard $(chrome_source_root)/content/*.xul) \
               $(wildcard $(chrome_source_root)/content/*.xml) \
               $(wildcard $(chrome_source_root)/content/*.css) \
               $(wildcard $(chrome_source_root)/skin/*.css) \
               $(wildcard $(chrome_source_root)/skin/*.png) \
               $(wildcard $(chrome_source_root)/locale/*/*.dtd) \
               $(wildcard $(chrome_source_root)/locale/*/*.properties)

# The modules (JSM) dir.
modules_dir := modules

# The sources for the module files.
modules_sources := $(wildcard $(modules_dir)/*.js)

# The sources for the XPI file. Uses variables defined in the included
# Makefiles.
xpi_includes := $(license) \
             $(install_rdf) \
             $(chrome_manifest) \
             $(preferences_dir)/prefs.js \
             $(chrome_sources) \
             $(modules_sources)

# Destination files
build_includes := $(foreach f,$(xpi_includes),$(build_dir)/$(f))


$(xpi_built): $(build_dir) $(build_includes)
	@echo "Creating XPI file."
	@cd $(build_dir); $(ZIP) $(xpi_file) $(xpi_includes)
	@echo "Creating XPI file. Done!"

# This builds the extension XPI file.
.PHONY: all
all: $(xpi_built)
	@echo
	@echo "Build finished successfully."
	@echo

# This cleans all temporary files and directories created by 'make'.
.PHONY: clean
clean: clean_build clean_profile
	@echo "Cleanup is done."

# This builds everything except for the actual XPI, and then it copies it to the
# specified profile directory, allowing a quick update that requires no install.
.PHONY: install
install: $(xpi_built) $(profile_location)
	@echo "Installing in profile folder: $(profile_location)"
	@cp -f $(xpi_built) $(profile_location)/$(xpi_deployed)
	@echo "Installing in profile folder. Done!"
	@echo

# Regex for 'no'
YES_RE := yes|y|Y|true|on

# called via $(build_includes)
$(build_dir)/%: %
	@mkdir -p $(dir $@)
	@cp -f $< $@

# Debug calls are removed for performance.
# NOTE: we could also use m4 for filtering source files...
$(build_dir)/$(chrome_source_root)/%.js: $(chrome_source_root)/%.js
	@mkdir -p $(dir $@)
	@if [[ "$(DEBUG)" =~ $(YES_RE) ]]; \
  then \
    cp -f $< $@; \
  else \
    echo "Stripping comments from JS file $<"; \
    sed '/mozt\.Debug\.dump/d' $< > $@; \
  fi

$(build_dir)/$(modules_dir)/commons.js: $(modules_dir)/commons.js
	@mkdir -p $(dir $@)
	@if [[ "$(DEBUG)" =~ $(YES_RE) ]]; \
  then \
    cp -f $< $@; \
  else \
    echo "Turning DEBUG_MODE off."; \
    sed 's/DEBUG_MODE: true/DEBUG_MODE: false/' $< > $@; \
  fi

$(build_dir):
	@if [ ! -x $(build_dir) ]; \
  then \
    mkdir -p $(build_dir); \
  fi

$(profile_location):
	@echo "Creating extension folder: $(profile_location)"
	@if [ ! -x $(profile_location) ]; \
  then \
    mkdir -p $(profile_location); \
  fi

clean_build:
	@echo "Removing build dir: $(build_dir)"
	@rm -rf $(build_dir)

clean_profile:
	@echo "Removing extension from extension folder: $(profile_location)"
	@rm -f $(profile_location)/$(xpi_deployed)