package main

import (
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"time"

	"fyne.io/systray"
)

// Tray icon (simple circle - can be replaced with proper icon)
var iconData = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0xf3, 0xff, 0x61, 0x00, 0x00, 0x00,
	0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xae, 0xce, 0x1c, 0xe9, 0x00, 0x00,
	0x00, 0x6a, 0x49, 0x44, 0x41, 0x54, 0x38, 0x8d, 0xed, 0xd2, 0x31, 0x0a,
	0xc0, 0x20, 0x0c, 0x05, 0xd0, 0xaf, 0xdd, 0x3d, 0x73, 0xef, 0xe0, 0xbd,
	0x74, 0x70, 0x74, 0x10, 0x07, 0x0b, 0x45, 0x10, 0x6c, 0xd3, 0x4e, 0x6d,
	0xe0, 0x0f, 0x81, 0x24, 0x3f, 0x21, 0x00, 0x00, 0xf8, 0x35, 0x65, 0xf4,
	0x1e, 0xab, 0xb0, 0x8e, 0x1b, 0x5d, 0x16, 0x36, 0xf0, 0x43, 0x9f, 0x05,
	0x1b, 0x78, 0x03, 0x2f, 0x06, 0x1b, 0x58, 0xc3, 0x8d, 0x2e, 0x0b, 0x1b,
	0xf8, 0xa1, 0xcf, 0x82, 0x0d, 0xbc, 0x81, 0x17, 0x83, 0x0d, 0xec, 0x01,
	0x00, 0x00, 0x60, 0xcd, 0x25, 0xec, 0x8a, 0xa7, 0xb0, 0xb7, 0xe1, 0xa9,
	0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

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
