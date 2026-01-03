.PHONY: all cli desktop clean install dev

# Default: build both
all: cli desktop

# Build Go CLI
cli:
	cd cli && go build -o thymer .

# Build Go desktop app
desktop:
	cd desktop && go build -o thymer-desktop .

# Install CLI to /usr/local/bin
install: cli
	sudo cp cli/thymer /usr/local/bin/

# Install CLI to ~/.local/bin (no sudo)
install-local: cli
	mkdir -p ~/.local/bin
	cp cli/thymer ~/.local/bin/

# Install desktop to ~/.local/bin
install-desktop: desktop
	mkdir -p ~/.local/bin
	cp desktop/thymer-desktop ~/.local/bin/

# Development mode - run desktop
dev: desktop
	./desktop/thymer-desktop

# Run in headless mode (no tray)
headless: desktop
	./desktop/thymer-desktop --headless

# Clean build artifacts
clean:
	rm -f cli/thymer
	rm -f desktop/thymer-desktop

# Cross-compile CLI for all platforms
cli-all:
	cd cli && GOOS=linux GOARCH=amd64 go build -o thymer-linux-amd64 .
	cd cli && GOOS=linux GOARCH=arm64 go build -o thymer-linux-arm64 .
	cd cli && GOOS=darwin GOARCH=amd64 go build -o thymer-darwin-amd64 .
	cd cli && GOOS=darwin GOARCH=arm64 go build -o thymer-darwin-arm64 .
	cd cli && GOOS=windows GOARCH=amd64 go build -o thymer-windows-amd64.exe .

# Cross-compile desktop for all platforms
desktop-all:
	cd desktop && GOOS=linux GOARCH=amd64 go build -o thymer-desktop-linux-amd64 .
	cd desktop && GOOS=darwin GOARCH=amd64 go build -o thymer-desktop-darwin-amd64 .
	cd desktop && GOOS=darwin GOARCH=arm64 go build -o thymer-desktop-darwin-arm64 .
	cd desktop && GOOS=windows GOARCH=amd64 go build -o thymer-desktop-windows-amd64.exe .

# Help
help:
	@echo "Thymer Desktop & CLI Build"
	@echo ""
	@echo "Usage:"
	@echo "  make              Build both CLI and desktop"
	@echo "  make cli          Build Go CLI only"
	@echo "  make desktop      Build Go desktop app"
	@echo "  make install      Install CLI to /usr/local/bin (requires sudo)"
	@echo "  make install-local Install CLI to ~/.local/bin"
	@echo "  make install-desktop Install desktop to ~/.local/bin"
	@echo "  make dev          Build and run desktop app"
	@echo "  make headless     Run desktop without system tray"
	@echo "  make clean        Remove build artifacts"
	@echo "  make cli-all      Cross-compile CLI for all platforms"
	@echo "  make desktop-all  Cross-compile desktop for all platforms"
