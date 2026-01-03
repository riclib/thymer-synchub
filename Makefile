.PHONY: all cli desktop clean install dev

# Default: build both
all: cli desktop

# Build Go CLI
cli:
	cd cli && go build -o thymer .

# Build Electron app (TypeScript only, not packaged)
desktop:
	cd desktop && npm install && npm run build

# Build packaged Electron app
desktop-package:
	cd desktop && npm install && npm run package

# Install CLI to /usr/local/bin
install: cli
	sudo cp cli/thymer /usr/local/bin/

# Install CLI to ~/.local/bin (no sudo)
install-local: cli
	mkdir -p ~/.local/bin
	cp cli/thymer ~/.local/bin/

# Development mode
dev:
	@echo "Starting desktop in dev mode..."
	cd desktop && npm run dev

# Clean build artifacts
clean:
	rm -f cli/thymer
	rm -rf desktop/dist
	rm -rf desktop/out

# Run desktop app
run: desktop
	cd desktop && npm start

# Cross-compile CLI for all platforms
cli-all:
	cd cli && GOOS=linux GOARCH=amd64 go build -o thymer-linux-amd64 .
	cd cli && GOOS=linux GOARCH=arm64 go build -o thymer-linux-arm64 .
	cd cli && GOOS=darwin GOARCH=amd64 go build -o thymer-darwin-amd64 .
	cd cli && GOOS=darwin GOARCH=arm64 go build -o thymer-darwin-arm64 .
	cd cli && GOOS=windows GOARCH=amd64 go build -o thymer-windows-amd64.exe .

# Help
help:
	@echo "Thymer Desktop & CLI Build"
	@echo ""
	@echo "Usage:"
	@echo "  make              Build both CLI and desktop"
	@echo "  make cli          Build Go CLI only"
	@echo "  make desktop      Build Electron app (TypeScript)"
	@echo "  make desktop-package  Package Electron app for distribution"
	@echo "  make install      Install CLI to /usr/local/bin (requires sudo)"
	@echo "  make install-local Install CLI to ~/.local/bin"
	@echo "  make dev          Run desktop in development mode"
	@echo "  make run          Run desktop app"
	@echo "  make clean        Remove build artifacts"
	@echo "  make cli-all      Cross-compile CLI for all platforms"
