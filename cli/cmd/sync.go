package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/spf13/cobra"
)

var syncAll bool

var syncCmd = &cobra.Command{
	Use:   "sync [plugin]",
	Short: "Trigger a sync",
	Long: `Trigger a sync for a specific plugin or all plugins.

Examples:
  thymer sync github
  thymer sync readwise
  thymer sync --all`,
	Run: runSync,
}

func init() {
	syncCmd.Flags().BoolVar(&syncAll, "all", false, "Sync all enabled plugins")

	rootCmd.AddCommand(syncCmd)
}

func runSync(cmd *cobra.Command, args []string) {
	if !syncAll && len(args) == 0 {
		exitError("Specify a plugin name or use --all")
	}

	var payload map[string]interface{}
	if syncAll {
		payload = map[string]interface{}{"all": true}
	} else {
		payload = map[string]interface{}{"plugin": args[0]}
	}

	body, _ := json.Marshal(payload)
	resp, err := http.Post(serverAddr+"/api/sync", "application/json", bytes.NewReader(body))
	if err != nil {
		exitError("Failed to connect to Thymer Desktop: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		exitError("Sync failed: %s", string(respBody))
	}

	if jsonOutput {
		fmt.Println(string(respBody))
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		fmt.Println("Sync triggered")
		return
	}

	if msg, ok := result["message"]; ok {
		fmt.Println(msg)
	} else {
		fmt.Println("Sync triggered")
	}
}
