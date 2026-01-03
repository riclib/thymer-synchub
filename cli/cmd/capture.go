package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/spf13/cobra"
)

var (
	captureSource string
	captureTags   string
)

var captureCmd = &cobra.Command{
	Use:   "capture [text]",
	Short: "Quick capture a note",
	Long: `Capture a quick note to the Captures collection.

Examples:
  thymer capture "Remember to check the logs"
  thymer capture "$(wl-paste)"
  thymer capture --source=cli "Note with source"
  echo "piped content" | thymer capture -`,
	Args: cobra.MinimumNArgs(1),
	Run:  runCapture,
}

func init() {
	captureCmd.Flags().StringVar(&captureSource, "source", "cli", "Source label for the capture")
	captureCmd.Flags().StringVar(&captureTags, "tags", "", "Comma-separated tags")

	rootCmd.AddCommand(captureCmd)
}

func runCapture(cmd *cobra.Command, args []string) {
	text := strings.Join(args, " ")

	// Handle stdin
	if text == "-" {
		stdin, err := io.ReadAll(cmd.InOrStdin())
		if err != nil {
			exitError("Failed to read stdin: %v", err)
		}
		text = strings.TrimSpace(string(stdin))
	}

	if text == "" {
		exitError("Nothing to capture")
	}

	payload := map[string]interface{}{
		"text":   text,
		"source": captureSource,
	}
	if captureTags != "" {
		payload["tags"] = strings.Split(captureTags, ",")
	}

	body, _ := json.Marshal(payload)
	resp, err := http.Post(serverAddr+"/api/capture", "application/json", bytes.NewReader(body))
	if err != nil {
		exitError("Failed to connect to Thymer Desktop: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		exitError("Capture failed: %s", string(respBody))
	}

	if jsonOutput {
		fmt.Println(string(respBody))
		return
	}

	fmt.Println("Captured!")
}
