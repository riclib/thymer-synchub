package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/spf13/cobra"
)

var (
	mcpHTTPAddr string
)

var mcpServeCmd = &cobra.Command{
	Use:   "serve",
	Short: "Run as MCP server",
	Long: `Run as an MCP server. Supports two transports:

  stdio (default): For Claude Desktop integration
  http:            For remote access (Claude mobile, cloud deployment)

Examples:
  thymer mcp serve              # stdio mode for Claude Desktop
  thymer mcp serve --http :8080 # HTTP mode for remote access`,
	Run: runMcpServe,
}

func init() {
	mcpServeCmd.Flags().StringVar(&mcpHTTPAddr, "http", "", "HTTP address to listen on (e.g., :8080)")
	mcpCmd.AddCommand(mcpServeCmd)
}

func runMcpServe(cmd *cobra.Command, args []string) {
	// Create MCP server
	server := mcp.NewServer(
		&mcp.Implementation{
			Name:    "thymer",
			Version: "0.1.0",
		},
		nil,
	)

	// Fetch and register tools from thymer-bar
	if err := registerToolsFromDesktop(server); err != nil {
		log.Printf("[MCP] Warning: Could not fetch tools from thymer-bar: %v", err)
		log.Printf("[MCP] Server will start without tools. Ensure thymer-bar is running.")
	}

	ctx := context.Background()

	if mcpHTTPAddr != "" {
		// HTTP mode
		log.Printf("[MCP] Starting HTTP server on %s", mcpHTTPAddr)
		handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
			return server
		}, nil)
		if err := http.ListenAndServe(mcpHTTPAddr, handler); err != nil {
			log.Fatalf("[MCP] HTTP server error: %v", err)
		}
	} else {
		// Stdio mode (default)
		if err := server.Run(ctx, &mcp.StdioTransport{}); err != nil {
			fmt.Fprintf(os.Stderr, "MCP server error: %v\n", err)
			os.Exit(1)
		}
	}
}

// registerToolsFromDesktop fetches tools from thymer-bar and registers them
func registerToolsFromDesktop(server *mcp.Server) error {
	resp, err := http.Get(serverAddr + "/api/mcp/tools")
	if err != nil {
		return fmt.Errorf("failed to connect to thymer-bar: %w", err)
	}
	defer resp.Body.Close()

	var tools []struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		InputSchema map[string]interface{} `json:"inputSchema"`
	}

	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, &tools); err != nil {
		return fmt.Errorf("failed to parse tools: %w", err)
	}

	log.Printf("[MCP] Registering %d tools from thymer-bar", len(tools))

	for _, t := range tools {
		// Build input schema - must be type "object"
		inputSchema := t.InputSchema
		if inputSchema == nil {
			inputSchema = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
		}

		tool := &mcp.Tool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: inputSchema,
		}

		// Register with a dynamic handler that proxies to thymer-bar
		toolName := t.Name // capture for closure
		mcp.AddTool(server, tool, func(ctx context.Context, req *mcp.CallToolRequest, input map[string]interface{}) (*mcp.CallToolResult, map[string]interface{}, error) {
			result, err := executeToolViaDesktopSDK(toolName, input)
			if err != nil {
				return nil, nil, err
			}
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.TextContent{Text: result},
				},
			}, nil, nil
		})
	}

	return nil
}

// executeToolViaDesktopSDK calls a tool via thymer-bar HTTP API
func executeToolViaDesktopSDK(name string, args map[string]interface{}) (string, error) {
	payload, _ := json.Marshal(map[string]interface{}{
		"name": name,
		"args": args,
	})

	resp, err := http.Post(serverAddr+"/api/mcp/call", "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return "", fmt.Errorf("failed to connect to thymer-bar: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	return string(body), nil
}
