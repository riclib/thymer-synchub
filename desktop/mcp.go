package main

import (
	"context"
	"encoding/json"
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

	// Create HTTP mux with both stateful and stateless endpoints
	mux := http.NewServeMux()

	// Stateful endpoint (with sessions) - for full MCP compliance
	statefulHandler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return m.server
	}, nil)
	mux.Handle("/mcp", statefulHandler)

	// Stateless endpoint - simple JSON-RPC, no sessions
	mux.HandleFunc("/", m.handleStateless)

	// Start HTTP server
	addr := fmt.Sprintf(":%d", m.port)
	m.httpServer = &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	go func() {
		log.Printf("[MCP] Server listening on http://127.0.0.1%s (stateless) and http://127.0.0.1%s/mcp (stateful)", addr, addr)
		if err := m.httpServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[MCP] Server error: %v", err)
		}
	}()

	return nil
}

// handleStateless handles MCP JSON-RPC without sessions
func (m *MCPServer) handleStateless(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		JSONRPC string                 `json:"jsonrpc"`
		ID      interface{}            `json:"id"`
		Method  string                 `json:"method"`
		Params  map[string]interface{} `json:"params"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		m.jsonRPCError(w, nil, -32700, "Parse error")
		return
	}

	w.Header().Set("Content-Type", "application/json")

	switch req.Method {
	case "initialize":
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"protocolVersion": "2024-11-05",
				"serverInfo":      map[string]string{"name": "thymer", "version": "0.1.0"},
				"capabilities":    map[string]interface{}{"tools": map[string]bool{"listChanged": true}},
			},
		})

	case "notifications/initialized":
		// No response needed for notifications
		w.WriteHeader(http.StatusNoContent)

	case "tools/list":
		tools := m.bridge.GetTools()
		mcpTools := make([]map[string]interface{}, 0, len(tools))
		for _, t := range tools {
			inputSchema := map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
			if t.Parameters != nil {
				inputSchema = t.Parameters
			}
			mcpTools = append(mcpTools, map[string]interface{}{
				"name":        t.Name,
				"description": t.Description,
				"inputSchema": inputSchema,
			})
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  map[string]interface{}{"tools": mcpTools},
		})

	case "tools/call":
		name, _ := req.Params["name"].(string)
		args, _ := req.Params["arguments"].(map[string]interface{})
		if name == "" {
			m.jsonRPCError(w, req.ID, -32602, "Invalid params: name required")
			return
		}
		structured, err := m.executeTool(name, args)
		if err != nil {
			m.jsonRPCError(w, req.ID, -32000, err.Error())
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": map[string]interface{}{
				"content":           []interface{}{},
				"structuredContent": structured,
			},
		})

	default:
		m.jsonRPCError(w, req.ID, -32601, "Method not found: "+req.Method)
	}
}

func (m *MCPServer) jsonRPCError(w http.ResponseWriter, id interface{}, code int, message string) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
		"error":   map[string]interface{}{"code": code, "message": message},
	})
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
			structured, err := m.executeTool(toolName, input)
			if err != nil {
				return nil, nil, err
			}
			// Return as structured content for Claude Code
			return &mcp.CallToolResult{
				Content: []mcp.Content{},
			}, structured, nil
		})
	}
}

func (m *MCPServer) executeTool(name string, args map[string]interface{}) (map[string]interface{}, error) {
	result, err := m.bridge.ExecuteTool(name, args)
	if err != nil {
		return nil, err
	}

	// Parse JSON result into structured content
	var structured map[string]interface{}
	if err := json.Unmarshal(result, &structured); err != nil {
		// If not valid JSON, wrap the text
		return map[string]interface{}{"text": string(result)}, nil
	}
	return structured, nil
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
