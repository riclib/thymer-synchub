package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var (
	// Flags
	jsonOutput bool
	serverAddr string
)

var rootCmd = &cobra.Command{
	Use:   "thymer",
	Short: "CLI for Thymer Sync Hub",
	Long: `Thymer CLI - interact with your Thymer workspace from the command line.

Connects to Thymer Desktop for CORS-free access to your data and local LLMs.

Examples:
  thymer query issues --state=open
  thymer sync github
  thymer capture "Quick note from terminal"
  thymer mcp status`,
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.PersistentFlags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	rootCmd.PersistentFlags().StringVar(&serverAddr, "server", "http://localhost:9847", "Thymer Desktop server address")
}

// Helper to print errors consistently
func exitError(msg string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "Error: "+msg+"\n", args...)
	os.Exit(1)
}
