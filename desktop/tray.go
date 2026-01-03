package main

import (
	_ "embed"
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"time"

	"fyne.io/systray"
)

//go:embed icon.png
var iconData []byte

// RunTray starts the system tray and blocks until quit
func (a *App) RunTray() {
	systray.Run(a.onTrayReady, a.onTrayExit)
}

func (a *App) onTrayReady() {
	systray.SetIcon(iconData)
	systray.SetTitle("Thymer")
	systray.SetTooltip("Thymer Desktop")

	// Status item (not clickable)
	mStatus := systray.AddMenuItem("Connecting...", "Connection status")
	mStatus.Disable()

	systray.AddSeparator()

	// Open Thymer
	mOpenThymer := systray.AddMenuItem("Open Thymer", "Open Thymer in browser")

	// Sync All
	mSyncAll := systray.AddMenuItem("Sync All", "Trigger sync for all plugins")

	systray.AddSeparator()

	// Settings submenu
	mSettings := systray.AddMenuItem("Settings", "Configuration")
	mWorkspace := mSettings.AddSubMenuItem(
		fmt.Sprintf("Workspace: %s", a.config.Workspace),
		"Current workspace",
	)
	mWorkspace.Disable()

	mPorts := mSettings.AddSubMenuItem(
		fmt.Sprintf("HTTP: %d, WS: %d", a.httpPort, a.wsPort),
		"Server ports",
	)
	mPorts.Disable()

	systray.AddSeparator()

	// Quit
	mQuit := systray.AddMenuItem("Quit", "Quit Thymer Desktop")

	// Update status periodically
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				if a.IsConnected() {
					count := a.ToolCount()
					mStatus.SetTitle(fmt.Sprintf("● Connected (%d tools)", count))
					mStatus.SetTooltip("SyncHub is connected")
				} else {
					mStatus.SetTitle("○ Waiting for SyncHub...")
					mStatus.SetTooltip("Open Thymer in browser to connect")
				}
			case <-a.ctx.Done():
				return
			}
		}
	}()

	// Handle menu clicks
	go func() {
		for {
			select {
			case <-mOpenThymer.ClickedCh:
				openBrowser(a.config.ThymerURL())

			case <-mSyncAll.ClickedCh:
				if a.IsConnected() {
					go func() {
						if err := a.bridge.SyncAll(); err != nil {
							log.Printf("[Tray] Sync failed: %v", err)
						} else {
							log.Println("[Tray] Sync triggered for all plugins")
						}
					}()
				}

			case <-mQuit.ClickedCh:
				systray.Quit()
				return

			case <-a.ctx.Done():
				return
			}
		}
	}()
}

func (a *App) onTrayExit() {
	log.Println("[Tray] Exiting...")
	a.Stop()
}

func openBrowser(url string) {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	}

	if cmd != nil {
		cmd.Start()
	}
}
