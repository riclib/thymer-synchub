package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/spf13/cobra"
)

var (
	queryState    string
	queryRepo     string
	queryAssignee string
	queryLimit    int
)

var queryCmd = &cobra.Command{
	Use:   "query [collection]",
	Short: "Query a collection",
	Long: `Query records from a Thymer collection.

Examples:
  thymer query issues --state=open
  thymer query issues --repo=anthropics/claude-code --limit=10
  thymer query captures --limit=5
  thymer query calendar --json`,
	Args: cobra.ExactArgs(1),
	Run:  runQuery,
}

func init() {
	queryCmd.Flags().StringVar(&queryState, "state", "", "Filter by state (open, closed, etc.)")
	queryCmd.Flags().StringVar(&queryRepo, "repo", "", "Filter by repository")
	queryCmd.Flags().StringVar(&queryAssignee, "assignee", "", "Filter by assignee")
	queryCmd.Flags().IntVar(&queryLimit, "limit", 20, "Maximum results to return")

	rootCmd.AddCommand(queryCmd)
}

func runQuery(cmd *cobra.Command, args []string) {
	collection := args[0]

	// Build query params
	params := url.Values{}
	params.Set("collection", collection)
	if queryState != "" {
		params.Set("state", queryState)
	}
	if queryRepo != "" {
		params.Set("repo", queryRepo)
	}
	if queryAssignee != "" {
		params.Set("assignee", queryAssignee)
	}
	params.Set("limit", fmt.Sprintf("%d", queryLimit))

	// Call desktop API
	resp, err := http.Get(serverAddr + "/api/query?" + params.Encode())
	if err != nil {
		exitError("Failed to connect to Thymer Desktop: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		exitError("Query failed: %s", string(body))
	}

	if jsonOutput {
		fmt.Println(string(body))
		return
	}

	// Pretty print results
	var results []map[string]interface{}
	if err := json.Unmarshal(body, &results); err != nil {
		fmt.Println(string(body))
		return
	}

	if len(results) == 0 {
		fmt.Println("No results found")
		return
	}

	for _, r := range results {
		title := r["title"]
		state := r["state"]
		guid := r["guid"]

		stateStr := ""
		if state != nil {
			stateStr = fmt.Sprintf(" [%s]", state)
		}

		fmt.Printf("• %s%s\n", title, stateStr)
		if jsonOutput {
			fmt.Printf("  guid: %s\n", guid)
		}
	}

	fmt.Printf("\n%d result(s)\n", len(results))
}

// formatTable formats results as a simple table
func formatTable(results []map[string]interface{}, columns []string) string {
	if len(results) == 0 {
		return "No results"
	}

	var sb strings.Builder
	for _, r := range results {
		var parts []string
		for _, col := range columns {
			if v, ok := r[col]; ok && v != nil {
				parts = append(parts, fmt.Sprintf("%v", v))
			}
		}
		sb.WriteString(strings.Join(parts, " | "))
		sb.WriteString("\n")
	}
	return sb.String()
}
