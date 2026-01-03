package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// handleStatus returns connection status
func (a *App) handleStatus(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"connected":  a.IsConnected(),
		"tools":      a.ToolCount(),
		"workspace":  a.config.Workspace,
		"thymer_url": a.config.ThymerURL(),
	}

	if a.bridge != nil {
		status["plugins"] = a.bridge.GetPlugins()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// handleQuery proxies collection queries to SyncHub
func (a *App) handleQuery(w http.ResponseWriter, r *http.Request) {
	if !a.IsConnected() {
		http.Error(w, `{"error":"SyncHub not connected"}`, http.StatusServiceUnavailable)
		return
	}

	collection := r.URL.Query().Get("collection")
	if collection == "" {
		http.Error(w, `{"error":"collection parameter required"}`, http.StatusBadRequest)
		return
	}

	// Build tool name based on collection
	toolName := collection + "_find"

	// Build args from query params
	args := make(map[string]interface{})
	for k, v := range r.URL.Query() {
		if k != "collection" && len(v) > 0 {
			args[k] = v[0]
		}
	}

	result, err := a.bridge.ExecuteTool(toolName, args)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(result)
}

// handleSync triggers a plugin sync
func (a *App) handleSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"POST only"}`, http.StatusMethodNotAllowed)
		return
	}

	if !a.IsConnected() {
		http.Error(w, `{"error":"SyncHub not connected"}`, http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Plugin string `json:"plugin"`
		All    bool   `json:"all"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	var err error
	if req.All {
		err = a.bridge.SyncAll()
	} else if req.Plugin != "" {
		err = a.bridge.Sync(req.Plugin)
	} else {
		http.Error(w, `{"error":"plugin or all required"}`, http.StatusBadRequest)
		return
	}

	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

// handleCapture creates a quick capture
func (a *App) handleCapture(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"POST only"}`, http.StatusMethodNotAllowed)
		return
	}

	if !a.IsConnected() {
		http.Error(w, `{"error":"SyncHub not connected"}`, http.StatusServiceUnavailable)
		return
	}

	body, _ := io.ReadAll(r.Body)

	var req struct {
		Text   string   `json:"text"`
		Source string   `json:"source"`
		Tags   []string `json:"tags"`
	}

	if err := json.Unmarshal(body, &req); err != nil {
		// Treat as plain text
		req.Text = string(body)
		req.Source = "cli"
	}

	if req.Text == "" {
		http.Error(w, `{"error":"text required"}`, http.StatusBadRequest)
		return
	}

	// Use the log_to_journal tool for quick captures
	result, err := a.bridge.ExecuteTool("log_to_journal", map[string]interface{}{
		"content": req.Text,
	})

	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(result)
}

// handleMCPTools returns available tools in MCP format
func (a *App) handleMCPTools(w http.ResponseWriter, r *http.Request) {
	tools := a.bridge.GetTools()

	mcpTools := make([]map[string]interface{}, 0, len(tools))
	for _, t := range tools {
		mcpTool := map[string]interface{}{
			"name":        t.Name,
			"description": t.Description,
		}
		if t.Parameters != nil {
			mcpTool["inputSchema"] = t.Parameters
		} else {
			mcpTool["inputSchema"] = map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			}
		}
		mcpTools = append(mcpTools, mcpTool)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mcpTools)
}

// handleMCPCall executes a tool call
func (a *App) handleMCPCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"POST only"}`, http.StatusMethodNotAllowed)
		return
	}

	if !a.IsConnected() {
		http.Error(w, `{"error":"SyncHub not connected"}`, http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Name string                 `json:"name"`
		Args map[string]interface{} `json:"args"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	result, err := a.bridge.ExecuteTool(req.Name, req.Args)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(result)
}
