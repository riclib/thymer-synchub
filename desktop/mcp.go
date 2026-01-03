package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const DefaultMCPPort = 9850

// MCPServer wraps the MCP SDK server
type MCPServer struct {
	port       int
	bridge     *Bridge
	server     *mcp.Server
	httpServer *http.Server
}

func NewMCPServer(port int, bridge *Bridge) *MCPServer {
	return &MCPServer{
		port:   port,
		bridge: bridge,
	}
}

func (m *MCPServer) Start() error {
	// Create MCP server
	m.server = mcp.NewServer(
		&mcp.Implementation{
			Name:    "thymer",
			Version: "0.1.0",
		},
		nil,
	)

	// Register tools from bridge
	m.registerTools()

	// Create HTTP handler
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return m.server
	}, nil)

	// Start HTTP server
	addr := fmt.Sprintf(":%d", m.port)
	m.httpServer = &http.Server{
		Addr:    addr,
		Handler: handler,
	}

	go func() {
		log.Printf("[MCP] Server listening on http://127.0.0.1%s", addr)
		if err := m.httpServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[MCP] Server error: %v", err)
		}
	}()

	return nil
}

func (m *MCPServer) registerTools() {
	tools := m.bridge.GetTools()
	log.Printf("[MCP] Registering %d tools", len(tools))

	for _, t := range tools {
		// Build input schema
		var inputSchema interface{} = map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		}
		if t.Parameters != nil {
			inputSchema = t.Parameters
		}

		tool := &mcp.Tool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: inputSchema,
		}

		// Capture tool name for closure
		toolName := t.Name
		mcp.AddTool(m.server, tool, func(ctx context.Context, req *mcp.CallToolRequest, input map[string]interface{}) (*mcp.CallToolResult, map[string]interface{}, error) {
			result, err := m.executeTool(toolName, input)
			if err != nil {
				return nil, nil, err
			}
			return &mcp.CallToolResult{
				Content: []mcp.Content{
					&mcp.TextContent{Text: result},
				},
			}, map[string]interface{}{}, nil
		})
	}
}

func (m *MCPServer) executeTool(name string, args map[string]interface{}) (string, error) {
	result, err := m.bridge.ExecuteTool(name, args)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

func (m *MCPServer) Stop() {
	if m.httpServer != nil {
		log.Println("[MCP] Shutting down server")
		m.httpServer.Close()
		m.httpServer = nil
	}
}

// RefreshTools re-registers tools when SyncHub reconnects
func (m *MCPServer) RefreshTools() {
	if m.server == nil {
		return
	}
	// Note: The SDK doesn't support removing tools, so we just log this
	// In practice, the tools list is fairly stable
	log.Printf("[MCP] Tools refresh requested (requires server restart for changes)")
}
