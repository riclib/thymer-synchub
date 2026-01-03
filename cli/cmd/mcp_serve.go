package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

var mcpServeCmd = &cobra.Command{
	Use:    "serve",
	Short:  "Run as MCP server (stdio mode)",
	Long:   `Run as an MCP server using stdio transport. Used by Claude Desktop.`,
	Hidden: true, // Internal command, invoked by Claude Desktop
	Run:    runMcpServe,
}

func init() {
	mcpCmd.AddCommand(mcpServeCmd)
}

// MCP JSON-RPC types
type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id"`
	Result  interface{} `json:"result,omitempty"`
	Error   *rpcError   `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func runMcpServe(cmd *cobra.Command, args []string) {
	reader := bufio.NewReader(os.Stdin)

	for {
		line, err := reader.ReadString('\n')
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var req jsonRPCRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			sendError(nil, -32700, "Parse error")
			continue
		}

		handleMcpRequest(&req)
	}
}

func handleMcpRequest(req *jsonRPCRequest) {
	switch req.Method {
	case "initialize":
		sendResult(req.ID, map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]interface{}{
				"tools": map[string]interface{}{},
			},
			"serverInfo": map[string]interface{}{
				"name":    "thymer",
				"version": "0.1.0",
			},
		})

	case "initialized":
		// No response needed for notification

	case "tools/list":
		tools := fetchToolsFromDesktop()
		sendResult(req.ID, map[string]interface{}{
			"tools": tools,
		})

	case "tools/call":
		var params struct {
			Name      string                 `json:"name"`
			Arguments map[string]interface{} `json:"arguments"`
		}
		json.Unmarshal(req.Params, &params)

		result := executeToolViaDesktop(params.Name, params.Arguments)
		sendResult(req.ID, map[string]interface{}{
			"content": []map[string]interface{}{
				{
					"type": "text",
					"text": result,
				},
			},
		})

	default:
		sendError(req.ID, -32601, "Method not found: "+req.Method)
	}
}

func fetchToolsFromDesktop() []map[string]interface{} {
	resp, err := http.Get(serverAddr + "/api/mcp/tools")
	if err != nil {
		return []map[string]interface{}{}
	}
	defer resp.Body.Close()

	var tools []map[string]interface{}
	body, _ := io.ReadAll(resp.Body)
	json.Unmarshal(body, &tools)

	// Convert to MCP format
	mcpTools := make([]map[string]interface{}, 0, len(tools))
	for _, t := range tools {
		mcpTool := map[string]interface{}{
			"name":        t["name"],
			"description": t["description"],
		}
		if params, ok := t["parameters"]; ok {
			mcpTool["inputSchema"] = params
		} else {
			mcpTool["inputSchema"] = map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			}
		}
		mcpTools = append(mcpTools, mcpTool)
	}

	return mcpTools
}

func executeToolViaDesktop(name string, args map[string]interface{}) string {
	payload, _ := json.Marshal(map[string]interface{}{
		"name": name,
		"args": args,
	})

	resp, err := http.Post(serverAddr+"/api/mcp/call", "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return fmt.Sprintf(`{"error": "Failed to connect to Thymer Desktop: %v"}`, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	return string(body)
}

func sendResult(id interface{}, result interface{}) {
	resp := jsonRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
	data, _ := json.Marshal(resp)
	fmt.Println(string(data))
}

func sendError(id interface{}, code int, message string) {
	resp := jsonRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &rpcError{Code: code, Message: message},
	}
	data, _ := json.Marshal(resp)
	fmt.Println(string(data))
}
