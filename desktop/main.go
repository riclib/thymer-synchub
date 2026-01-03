// Thymer Desktop - System tray app for bridging Thymer to CLI and MCP
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
)

const (
	Version     = "0.1.0"
	DefaultHTTP = 9847
	DefaultWS   = 9848
	DefaultMCP  = 9850
)

func main() {
	// Flags
	httpPort := flag.Int("http", DefaultHTTP, "HTTP API port")
	wsPort := flag.Int("ws", DefaultWS, "WebSocket port")
	mcpPort := flag.Int("mcp", DefaultMCP, "MCP server port (0 to disable)")
	headless := flag.Bool("headless", false, "Run without system tray (server only)")
	version := flag.Bool("version", false, "Show version")
	flag.Parse()

	if *version {
		fmt.Printf("thymer-desktop v%s\n", Version)
		return
	}

	// Load config
	cfg := LoadConfig()
	if cfg.Workspace == "" {
		// First run - need setup
		cfg.Workspace = promptWorkspace()
		cfg.Save()
	}

	log.Printf("[Desktop] Starting for workspace: %s", cfg.Workspace)

	// Create the app
	app := NewApp(cfg, *httpPort, *wsPort, *mcpPort)

	// Start servers
	if err := app.Start(); err != nil {
		log.Fatalf("[Desktop] Failed to start: %v", err)
	}

	if *headless {
		// Headless mode - wait for signal
		log.Println("[Desktop] Running in headless mode (Ctrl+C to quit)")
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("[Desktop] Shutting down...")
		app.Stop()
	} else {
		// Run with system tray (blocks until quit)
		app.RunTray()
	}
}

func promptWorkspace() string {
	fmt.Print("Enter your Thymer workspace (e.g., myworkspace.thymer.com): ")
	var workspace string
	fmt.Scanln(&workspace)
	if workspace == "" {
		workspace = "app.thymer.com"
	}
	return workspace
}
