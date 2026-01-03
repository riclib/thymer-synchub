package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
)

// App coordinates all desktop services
type App struct {
	config   *Config
	httpPort int
	wsPort   int
	mcpPort  int

	bridge     *Bridge
	httpServer *http.Server
	mcpServer  *MCPServer

	mu     sync.RWMutex
	ctx    context.Context
	cancel context.CancelFunc
}

func NewApp(cfg *Config, httpPort, wsPort, mcpPort int) *App {
	ctx, cancel := context.WithCancel(context.Background())
	return &App{
		config:   cfg,
		httpPort: httpPort,
		wsPort:   wsPort,
		mcpPort:  mcpPort,
		ctx:      ctx,
		cancel:   cancel,
	}
}

func (a *App) Start() error {
	// Start WebSocket bridge
	a.bridge = NewBridge(a.wsPort)

	// Set up MCP lifecycle callbacks
	if a.mcpPort > 0 {
		a.bridge.OnConnect = func() {
			log.Println("[App] SyncHub connected, starting MCP server")
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.mcpServer == nil {
				a.mcpServer = NewMCPServer(a.mcpPort, a.bridge)
				if err := a.mcpServer.Start(); err != nil {
					log.Printf("[App] Failed to start MCP server: %v", err)
				}
			}
		}
		a.bridge.OnDisconnect = func() {
			log.Println("[App] SyncHub disconnected, stopping MCP server")
			a.mu.Lock()
			defer a.mu.Unlock()
			if a.mcpServer != nil {
				a.mcpServer.Stop()
				a.mcpServer = nil
			}
		}
	}

	if err := a.bridge.Start(); err != nil {
		return fmt.Errorf("bridge: %w", err)
	}

	// Start HTTP API
	if err := a.startHTTP(); err != nil {
		return fmt.Errorf("http: %w", err)
	}

	return nil
}

func (a *App) Stop() {
	a.cancel()

	if a.mcpServer != nil {
		a.mcpServer.Stop()
	}

	if a.httpServer != nil {
		a.httpServer.Shutdown(context.Background())
	}

	if a.bridge != nil {
		a.bridge.Stop()
	}
}

func (a *App) startHTTP() error {
	mux := http.NewServeMux()

	// Status
	mux.HandleFunc("/api/status", a.handleStatus)

	// Query collections
	mux.HandleFunc("/api/query", a.handleQuery)

	// Trigger sync
	mux.HandleFunc("/api/sync", a.handleSync)

	// Capture
	mux.HandleFunc("/api/capture", a.handleCapture)

	// MCP tools
	mux.HandleFunc("/api/mcp/tools", a.handleMCPTools)
	mux.HandleFunc("/api/mcp/call", a.handleMCPCall)

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	a.httpServer = &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", a.httpPort),
		Handler: corsMiddleware(mux),
	}

	go func() {
		log.Printf("[HTTP] Server listening on http://127.0.0.1:%d", a.httpPort)
		if err := a.httpServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[HTTP] Server error: %v", err)
		}
	}()

	return nil
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// IsConnected returns true if SyncHub is connected
func (a *App) IsConnected() bool {
	if a.bridge == nil {
		return false
	}
	return a.bridge.IsConnected()
}

// ToolCount returns the number of registered tools
func (a *App) ToolCount() int {
	if a.bridge == nil {
		return 0
	}
	return len(a.bridge.GetTools())
}
