package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show Thymer Desktop status",
	Long: `Show the status of Thymer Desktop, including:
- Connection to Thymer
- Registered plugins
- Local LLM status
- MCP server status`,
	Run: runStatus,
}

func init() {
	rootCmd.AddCommand(statusCmd)
}

func runStatus(cmd *cobra.Command, args []string) {
	resp, err := http.Get(serverAddr + "/api/status")
	if err != nil {
		exitError("Thymer Desktop not running at %s", serverAddr)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if jsonOutput {
		fmt.Println(string(body))
		return
	}

	var status map[string]interface{}
	if err := json.Unmarshal(body, &status); err != nil {
		fmt.Println(string(body))
		return
	}

	// Pretty print status
	fmt.Println("Thymer Desktop")
	fmt.Println("==============")

	if connected, ok := status["thymer_connected"].(bool); ok {
		if connected {
			fmt.Println("Thymer:     ● Connected")
		} else {
			fmt.Println("Thymer:     ○ Disconnected")
		}
	}

	if llm, ok := status["llm"].(map[string]interface{}); ok {
		if running, _ := llm["running"].(bool); running {
			model := llm["model"]
			fmt.Printf("Local LLM:  ● %s\n", model)
		} else {
			fmt.Println("Local LLM:  ○ Not running")
		}
	}

	if mcp, ok := status["mcp"].(map[string]interface{}); ok {
		if running, _ := mcp["running"].(bool); running {
			transport := mcp["transport"]
			fmt.Printf("MCP Server: ● %s\n", transport)
		} else {
			fmt.Println("MCP Server: ○ Not running")
		}
	}

	if plugins, ok := status["plugins"].([]interface{}); ok {
		fmt.Printf("\nPlugins (%d):\n", len(plugins))
		for _, p := range plugins {
			if pm, ok := p.(map[string]interface{}); ok {
				name := pm["name"]
				enabled := pm["enabled"]
				if enabled == true {
					fmt.Printf("  ● %s\n", name)
				} else {
					fmt.Printf("  ○ %s\n", name)
				}
			}
		}
	}
}
