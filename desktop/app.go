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
	config     *Config
	httpPort   int
	wsPort     int
	llmPort    int
	llmBackend string

	bridge     *Bridge
	httpServer *http.Server
	llmProxy   *LLMProxy

	mu     sync.RWMutex
	ctx    context.Context
	cancel context.CancelFunc
}

func NewApp(cfg *Config, httpPort, wsPort, llmPort int, llmBackend string) *App {
	ctx, cancel := context.WithCancel(context.Background())
	return &App{
		config:     cfg,
		httpPort:   httpPort,
		wsPort:     wsPort,
		llmPort:    llmPort,
		llmBackend: llmBackend,
		ctx:        ctx,
		cancel:     cancel,
	}
}

func (a *App) Start() error {
	// Start WebSocket bridge
	a.bridge = NewBridge(a.wsPort)
	if err := a.bridge.Start(); err != nil {
		return fmt.Errorf("bridge: %w", err)
	}

	// Start HTTP API
	if err := a.startHTTP(); err != nil {
		return fmt.Errorf("http: %w", err)
	}

	// Start LLM proxy if port configured
	if a.llmPort > 0 {
		a.llmProxy = NewLLMProxy(a.llmPort, a.llmBackend)
		if err := a.llmProxy.Start(); err != nil {
			return fmt.Errorf("llm proxy: %w", err)
		}
	}

	return nil
}

func (a *App) Stop() {
	a.cancel()

	if a.httpServer != nil {
		a.httpServer.Shutdown(context.Background())
	}

	if a.bridge != nil {
		a.bridge.Stop()
	}

	if a.llmProxy != nil {
		a.llmProxy.Stop()
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
