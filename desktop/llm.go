package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	DefaultLLMBackend = "http://localhost:11434/v1" // Ollama's OpenAI-compatible endpoint
)

// LLMProxy handles WebSocket connections for LLM requests
type LLMProxy struct {
	port       int
	backendURL string
	server     *http.Server
	clients    map[*websocket.Conn]bool
	mu         sync.RWMutex
}

// ChatRequest is the OpenAI-compatible chat request
type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Stream      bool          `json:"stream"`
	Temperature float64       `json:"temperature,omitempty"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
}

// ChatMessage represents a chat message
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatResponse is the OpenAI-compatible response
type ChatResponse struct {
	ID      string       `json:"id"`
	Object  string       `json:"object"`
	Created int64        `json:"created"`
	Model   string       `json:"model"`
	Choices []ChatChoice `json:"choices"`
}

// ChatChoice represents a choice in the response
type ChatChoice struct {
	Index        int          `json:"index"`
	Message      *ChatMessage `json:"message,omitempty"`
	Delta        *ChatMessage `json:"delta,omitempty"`
	FinishReason string       `json:"finish_reason,omitempty"`
}

// WSMessage is the WebSocket message format
type WSMessage struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"` // "chat", "models", "cancel"
	Data   json.RawMessage `json:"data,omitempty"`
	Error  string          `json:"error,omitempty"`
	Done   bool            `json:"done,omitempty"`
	Stream bool            `json:"stream,omitempty"`
}

func NewLLMProxy(port int, backendURL string) *LLMProxy {
	if backendURL == "" {
		backendURL = DefaultLLMBackend
	}
	// Ensure no trailing slash
	backendURL = strings.TrimSuffix(backendURL, "/")
	return &LLMProxy{
		port:       port,
		backendURL: backendURL,
		clients:    make(map[*websocket.Conn]bool),
	}
}

func (p *LLMProxy) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", p.handleWebSocket)

	p.server = &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", p.port),
		Handler: mux,
	}

	go func() {
		log.Printf("[LLM] WebSocket proxy listening on ws://127.0.0.1:%d -> %s", p.port, p.backendURL)
		if err := p.server.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[LLM] Server error: %v", err)
		}
	}()

	return nil
}

func (p *LLMProxy) Stop() {
	if p.server != nil {
		p.server.Close()
	}
}

func (p *LLMProxy) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[LLM] Upgrade error: %v", err)
		return
	}
	defer conn.Close()

	p.mu.Lock()
	p.clients[conn] = true
	p.mu.Unlock()

	defer func() {
		p.mu.Lock()
		delete(p.clients, conn)
		p.mu.Unlock()
	}()

	log.Println("[LLM] Client connected")

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[LLM] Read error: %v", err)
			}
			break
		}

		var wsMsg WSMessage
		if err := json.Unmarshal(msg, &wsMsg); err != nil {
			p.sendError(conn, "", "Invalid message format")
			continue
		}

		switch wsMsg.Type {
		case "chat":
			go p.handleChat(conn, wsMsg)
		case "models":
			go p.handleModels(conn, wsMsg)
		default:
			p.sendError(conn, wsMsg.ID, "Unknown message type")
		}
	}

	log.Println("[LLM] Client disconnected")
}

func (p *LLMProxy) handleChat(conn *websocket.Conn, wsMsg WSMessage) {
	var req ChatRequest
	if err := json.Unmarshal(wsMsg.Data, &req); err != nil {
		p.sendError(conn, wsMsg.ID, "Invalid chat request")
		return
	}

	body, _ := json.Marshal(req)

	httpReq, err := http.NewRequest("POST", p.backendURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		p.sendError(conn, wsMsg.ID, "Failed to create request")
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(httpReq)
	if err != nil {
		p.sendError(conn, wsMsg.ID, fmt.Sprintf("Backend error: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		p.sendError(conn, wsMsg.ID, fmt.Sprintf("Backend error (%d): %s", resp.StatusCode, string(body)))
		return
	}

	if req.Stream {
		p.streamResponse(conn, wsMsg.ID, resp.Body)
	} else {
		p.sendFullResponse(conn, wsMsg.ID, resp.Body)
	}
}

func (p *LLMProxy) streamResponse(conn *websocket.Conn, id string, body io.Reader) {
	scanner := bufio.NewScanner(body)
	// Increase buffer size for long responses
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		// Skip empty lines
		if line == "" {
			continue
		}

		// Handle SSE format: "data: {...}"
		if strings.HasPrefix(line, "data: ") {
			line = strings.TrimPrefix(line, "data: ")
		}

		// Check for stream end
		if line == "[DONE]" {
			wsResp := WSMessage{
				ID:     id,
				Type:   "chunk",
				Done:   true,
				Stream: true,
			}
			data, _ := json.Marshal(wsResp)
			conn.WriteMessage(websocket.TextMessage, data)
			return
		}

		var chunk ChatResponse
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			continue
		}

		// Ensure the ID matches our request ID
		chunk.ID = id

		wsResp := WSMessage{
			ID:     id,
			Type:   "chunk",
			Stream: true,
		}

		// Check if this is the final chunk
		if len(chunk.Choices) > 0 && chunk.Choices[0].FinishReason != "" {
			wsResp.Done = true
		}

		wsResp.Data, _ = json.Marshal(chunk)
		data, _ := json.Marshal(wsResp)
		conn.WriteMessage(websocket.TextMessage, data)
	}
}

func (p *LLMProxy) sendFullResponse(conn *websocket.Conn, id string, body io.Reader) {
	var resp ChatResponse
	if err := json.NewDecoder(body).Decode(&resp); err != nil {
		p.sendError(conn, id, "Failed to parse response")
		return
	}

	resp.ID = id

	wsResp := WSMessage{
		ID:   id,
		Type: "response",
		Done: true,
	}
	wsResp.Data, _ = json.Marshal(resp)

	data, _ := json.Marshal(wsResp)
	conn.WriteMessage(websocket.TextMessage, data)
}

func (p *LLMProxy) handleModels(conn *websocket.Conn, wsMsg WSMessage) {
	resp, err := http.Get(p.backendURL + "/models")
	if err != nil {
		p.sendError(conn, wsMsg.ID, fmt.Sprintf("Failed to get models: %v", err))
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	wsResp := WSMessage{
		ID:   wsMsg.ID,
		Type: "models",
		Done: true,
		Data: body,
	}

	data, _ := json.Marshal(wsResp)
	conn.WriteMessage(websocket.TextMessage, data)
}

func (p *LLMProxy) sendError(conn *websocket.Conn, id, errMsg string) {
	wsResp := WSMessage{
		ID:    id,
		Type:  "error",
		Error: errMsg,
		Done:  true,
	}
	data, _ := json.Marshal(wsResp)
	conn.WriteMessage(websocket.TextMessage, data)
}
