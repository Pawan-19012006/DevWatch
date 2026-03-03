{
    "uuid": "devwatch@github.io",
    "name": "DevWatch",
    "description": "Project-aware developer intelligence layer for GNOME. Tracks running projects, ports, orphan processes, and build performance directly in your panel.",
    "shell-version": ["45", "46", "47", "48"],
    "url": "https://github.com/fosshack/devwatch",
    "version-name": "0.1.0",
    "session-modes": ["user"]
}
# DevWatch — Development Makefile
UUID     := devwatch@github.io
INSTALL  := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC      := $(shell pwd)

# Re-link every source file in the project to the GNOME extensions directory.
# Run this once after adding any new .js / .css / .json file to the project.
.PHONY: link
link:
	@mkdir -p $(INSTALL)
	@find $(SRC) -maxdepth 1 -name "*.js" -o -name "*.css" -o -name "*.json" | \
	  grep -v node_modules | grep -v "\.zip" | while read f; do \
	    ln -sf "$$f" "$(INSTALL)/$$(basename $$f)"; \
	    echo "  Linked: $$(basename $$f)"; \
	  done
	@for d in ui core utils schemas; do \
	  if [ -d "$(SRC)/$$d" ]; then \
	    mkdir -p "$(INSTALL)/$$d"; \
	    find "$(SRC)/$$d" -name "*.js" | while read f; do \
	      ln -sf "$$f" "$(INSTALL)/$$d/$$(basename $$f)"; \
	      echo "  Linked: $$d/$$(basename $$f)"; \
	    done; \
	  fi; \
	done

# Pack the extension into a distributable zip
.PHONY: pack
pack:
	gnome-extensions pack --force .

# Enable the extension (works only after a login where the shell picks it up)
.PHONY: enable
enable:
	gnome-extensions enable $(UUID)

# Disable the extension
.PHONY: disable
disable:
	gnome-extensions disable $(UUID)

# Tail the GNOME Shell log — your console.log() appears here
.PHONY: log
log:
	journalctl -f -o cat /usr/bin/gnome-shell

# Show extension status
.PHONY: status
status:
	gnome-extensions info $(UUID)

# Launch a nested Wayland GNOME Shell for safe testing (GNOME 48-)
# Use --devkit instead of --nested for GNOME 49+
.PHONY: nested
nested:
	dbus-run-session gnome-shell --devkit --wayland
