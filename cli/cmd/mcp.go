package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/spf13/cobra"
)

var mcpCmd = &cobra.Command{
	Use:   "mcp",
	Short: "MCP server management",
	Long:  `Manage the MCP (Model Context Protocol) server for AI assistant integration.`,
}

var mcpInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Install MCP configuration for Claude Desktop",
	Long: `Add Thymer as an MCP server in Claude Desktop configuration.

This allows Claude Desktop to use Thymer tools like:
- Query issues and captures
- Search your workspace
- Trigger syncs`,
	Run: runMcpInstall,
}

var mcpStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show MCP server status",
	Run:   runMcpStatus,
}

var mcpToolsCmd = &cobra.Command{
	Use:   "tools",
	Short: "List available MCP tools",
	Run:   runMcpTools,
}

func init() {
	mcpCmd.AddCommand(mcpInstallCmd)
	mcpCmd.AddCommand(mcpStatusCmd)
	mcpCmd.AddCommand(mcpToolsCmd)

	rootCmd.AddCommand(mcpCmd)
}

func runMcpInstall(cmd *cobra.Command, args []string) {
	// Find Claude Desktop config path
	var configPath string
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		configPath = filepath.Join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
	case "linux":
		home, _ := os.UserHomeDir()
		configPath = filepath.Join(home, ".config", "Claude", "claude_desktop_config.json")
	case "windows":
		appData := os.Getenv("APPDATA")
		configPath = filepath.Join(appData, "Claude", "claude_desktop_config.json")
	default:
		exitError("Unsupported platform: %s", runtime.GOOS)
	}

	// Read existing config or create new
	var config map[string]interface{}
	if data, err := os.ReadFile(configPath); err == nil {
		json.Unmarshal(data, &config)
	}
	if config == nil {
		config = make(map[string]interface{})
	}

	// Get or create mcpServers section
	mcpServers, ok := config["mcpServers"].(map[string]interface{})
	if !ok {
		mcpServers = make(map[string]interface{})
	}

	// Add thymer server config
	mcpServers["thymer"] = map[string]interface{}{
		"command": "thymer",
		"args":    []string{"mcp", "serve"},
	}

	config["mcpServers"] = mcpServers

	// Ensure directory exists
	os.MkdirAll(filepath.Dir(configPath), 0755)

	// Write config
	data, _ := json.MarshalIndent(config, "", "  ")
	if err := os.WriteFile(configPath, data, 0644); err != nil {
		exitError("Failed to write config: %v", err)
	}

	fmt.Printf("Installed Thymer MCP server to:\n  %s\n\n", configPath)
	fmt.Println("Restart Claude Desktop to activate.")
}

func runMcpStatus(cmd *cobra.Command, args []string) {
	resp, err := http.Get(serverAddr + "/api/mcp/status")
	if err != nil {
		exitError("Thymer Desktop not running")
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if jsonOutput {
		fmt.Println(string(body))
		return
	}

	var status map[string]interface{}
	json.Unmarshal(body, &status)

	if running, _ := status["running"].(bool); running {
		transport := status["transport"]
		clients := status["clients"]
		fmt.Printf("MCP Server: ● Running (%s)\n", transport)
		fmt.Printf("Clients:    %v connected\n", clients)
	} else {
		fmt.Println("MCP Server: ○ Not running")
	}
}

func runMcpTools(cmd *cobra.Command, args []string) {
	resp, err := http.Get(serverAddr + "/api/mcp/tools")
	if err != nil {
		exitError("Thymer Desktop not running")
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if jsonOutput {
		fmt.Println(string(body))
		return
	}

	var tools []map[string]interface{}
	if err := json.Unmarshal(body, &tools); err != nil {
		fmt.Println(string(body))
		return
	}

	fmt.Printf("Available MCP Tools (%d):\n\n", len(tools))
	for _, t := range tools {
		name := t["name"]
		desc := t["description"]
		fmt.Printf("  %s\n", name)
		if desc != nil {
			fmt.Printf("    %s\n\n", desc)
		}
	}
}
