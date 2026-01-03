package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins (localhost only)
	},
}

// Tool represents a registered tool from SyncHub
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters,omitempty"`
}

// Plugin represents a registered sync plugin
type Plugin struct {
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

// PendingCall tracks an outgoing request waiting for response
type PendingCall struct {
	Result chan json.RawMessage
	Error  chan error
}

// Bridge manages the WebSocket connection to SyncHub
type Bridge struct {
	port int

	server *http.Server
	client *websocket.Conn
	mu     sync.RWMutex

	tools   []Tool
	plugins []Plugin

	callID    atomic.Int64
	pending   map[string]*PendingCall
	pendingMu sync.RWMutex

	// Callbacks
	OnConnect    func()
	OnDisconnect func()
	connected    bool // tracks if OnConnect was called
}

func NewBridge(port int) *Bridge {
	return &Bridge{
		port:    port,
		pending: make(map[string]*PendingCall),
	}
}

func (b *Bridge) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", b.handleWebSocket)

	b.server = &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", b.port),
		Handler: mux,
	}

	go func() {
		log.Printf("[Bridge] WebSocket server listening on ws://127.0.0.1:%d", b.port)
		if err := b.server.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[Bridge] Server error: %v", err)
		}
	}()

	return nil
}

func (b *Bridge) Stop() {
	b.mu.Lock()
	if b.client != nil {
		b.client.Close()
		b.client = nil
	}
	b.mu.Unlock()

	if b.server != nil {
		b.server.Close()
	}
}

func (b *Bridge) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Bridge] Upgrade error: %v", err)
		return
	}

	log.Println("[Bridge] SyncHub connected")

	// Close previous connection if any
	b.mu.Lock()
	if b.client != nil {
		log.Println("[Bridge] Closing previous connection (replaced by new client)")
		b.client.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(1008, "Replaced by new client"),
			time.Now().Add(time.Second),
		)
		b.client.Close()
	}
	b.client = conn
	b.mu.Unlock()

	// Request initial state
	b.send(map[string]interface{}{"type": "get_tools"})
	b.send(map[string]interface{}{"type": "get_plugins"})

	// Read messages
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[Bridge] Read error: %v", err)
			break
		}
		b.handleMessage(msg)
	}

	b.mu.Lock()
	if b.client == conn {
		b.client = nil
		b.tools = nil
		b.plugins = nil
		wasConnected := b.connected
		b.connected = false
		b.mu.Unlock()
		log.Println("[Bridge] SyncHub disconnected")
		if wasConnected && b.OnDisconnect != nil {
			b.OnDisconnect()
		}
	} else {
		b.mu.Unlock()
	}
}

func (b *Bridge) handleMessage(data []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("[Bridge] Failed to parse message: %v", err)
		return
	}

	// Check if it's a response to a pending call
	if id, ok := msg["id"].(string); ok {
		b.pendingMu.RLock()
		pending, exists := b.pending[id]
		b.pendingMu.RUnlock()

		if exists {
			b.pendingMu.Lock()
			delete(b.pending, id)
			b.pendingMu.Unlock()

			if errMsg, ok := msg["error"].(string); ok {
				pending.Error <- fmt.Errorf("%s", errMsg)
			} else if result, ok := msg["result"]; ok {
				data, _ := json.Marshal(result)
				pending.Result <- data
			} else {
				pending.Result <- nil
			}
			return
		}
	}

	// Handle push messages from SyncHub
	msgType, _ := msg["type"].(string)
	switch msgType {
	case "tools":
		if toolsRaw, ok := msg["tools"].([]interface{}); ok {
			b.mu.Lock()
			b.tools = make([]Tool, 0, len(toolsRaw))
			for _, t := range toolsRaw {
				if toolMap, ok := t.(map[string]interface{}); ok {
					// Tools come in OpenAI function format: {type: "function", function: {name, description, parameters}}
					var name, description string
					var params map[string]interface{}

					if fn, ok := toolMap["function"].(map[string]interface{}); ok {
						name = getString(fn, "name")
						description = getString(fn, "description")
						if p, ok := fn["parameters"].(map[string]interface{}); ok {
							params = p
						}
					} else {
						// Fallback to flat format
						name = getString(toolMap, "name")
						description = getString(toolMap, "description")
						if p, ok := toolMap["parameters"].(map[string]interface{}); ok {
							params = p
						}
					}

					if name != "" {
						b.tools = append(b.tools, Tool{
							Name:        name,
							Description: description,
							Parameters:  params,
						})
					}
				}
			}
			// Call OnConnect after first tool registration
			if !b.connected && b.OnConnect != nil {
				b.connected = true
				b.mu.Unlock()
				log.Printf("[Bridge] Received %d tools from SyncHub", len(b.tools))
				b.OnConnect()
			} else {
				b.mu.Unlock()
				log.Printf("[Bridge] Received %d tools from SyncHub", len(b.tools))
			}
		}
		return

	case "plugins":
		if pluginsRaw, ok := msg["plugins"].([]interface{}); ok {
			b.mu.Lock()
			b.plugins = make([]Plugin, 0, len(pluginsRaw))
			for _, p := range pluginsRaw {
				if pluginMap, ok := p.(map[string]interface{}); ok {
					b.plugins = append(b.plugins, Plugin{
						Name:    getString(pluginMap, "name"),
						Enabled: getBool(pluginMap, "enabled"),
					})
				}
			}
			b.mu.Unlock()
			log.Printf("[Bridge] Received %d plugins from SyncHub", len(b.plugins))
		}

	case "register":
		version := getString(msg, "version")
		log.Printf("[Bridge] SyncHub registered: %s", version)

	case "sync_complete":
		plugin := getString(msg, "plugin")
		log.Printf("[Bridge] Sync complete: %s", plugin)
	}
}

func (b *Bridge) send(msg map[string]interface{}) error {
	b.mu.RLock()
	conn := b.client
	b.mu.RUnlock()

	if conn == nil {
		return fmt.Errorf("not connected")
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	return conn.WriteMessage(websocket.TextMessage, data)
}

// Call sends a request and waits for response
func (b *Bridge) Call(msgType string, params map[string]interface{}) (json.RawMessage, error) {
	id := fmt.Sprintf("call_%d", b.callID.Add(1))

	msg := map[string]interface{}{
		"id":   id,
		"type": msgType,
	}
	for k, v := range params {
		msg[k] = v
	}

	pending := &PendingCall{
		Result: make(chan json.RawMessage, 1),
		Error:  make(chan error, 1),
	}

	b.pendingMu.Lock()
	b.pending[id] = pending
	b.pendingMu.Unlock()

	defer func() {
		b.pendingMu.Lock()
		delete(b.pending, id)
		b.pendingMu.Unlock()
	}()

	if err := b.send(msg); err != nil {
		return nil, err
	}

	select {
	case result := <-pending.Result:
		return result, nil
	case err := <-pending.Error:
		return nil, err
	case <-time.After(30 * time.Second):
		return nil, fmt.Errorf("timeout")
	}
}

func (b *Bridge) IsConnected() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.client != nil
}

func (b *Bridge) GetTools() []Tool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.tools
}

func (b *Bridge) GetPlugins() []Plugin {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.plugins
}

// ExecuteTool calls a tool via SyncHub
func (b *Bridge) ExecuteTool(name string, args map[string]interface{}) (json.RawMessage, error) {
	return b.Call("tool_call", map[string]interface{}{
		"name": name,
		"args": args,
	})
}

// Sync triggers a plugin sync
func (b *Bridge) Sync(pluginID string) error {
	_, err := b.Call("sync", map[string]interface{}{
		"plugin": pluginID,
	})
	return err
}

// SyncAll triggers sync for all plugins
func (b *Bridge) SyncAll() error {
	_, err := b.Call("sync_all", nil)
	return err
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getBool(m map[string]interface{}, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}
