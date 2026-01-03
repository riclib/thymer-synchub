package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
)

type Config struct {
	Workspace   string `json:"workspace"`
	ThymerURL   string `json:"thymerUrl"`
	LLMModel    string `json:"llmModel,omitempty"`
	AutoStartLLM bool  `json:"autoStartLLM,omitempty"`
}

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage Thymer Desktop configuration",
	Long: `View and modify Thymer Desktop configuration.

Examples:
  thymer config show                    # Show current config
  thymer config set workspace liberato  # Set workspace
  thymer config path                    # Show config file path`,
}

var configShowCmd = &cobra.Command{
	Use:   "show",
	Short: "Show current configuration",
	Run:   runConfigShow,
}

var configSetCmd = &cobra.Command{
	Use:   "set [key] [value]",
	Short: "Set a configuration value",
	Long: `Set a configuration value.

Available keys:
  workspace    Your Thymer workspace name (e.g., liberato)

Examples:
  thymer config set workspace liberato`,
	Args: cobra.ExactArgs(2),
	Run:  runConfigSet,
}

var configPathCmd = &cobra.Command{
	Use:   "path",
	Short: "Show config file path",
	Run:   runConfigPath,
}

func init() {
	configCmd.AddCommand(configShowCmd)
	configCmd.AddCommand(configSetCmd)
	configCmd.AddCommand(configPathCmd)

	rootCmd.AddCommand(configCmd)
}

func getConfigDir() string {
	var configDir string
	switch runtime.GOOS {
	case "windows":
		configDir = filepath.Join(os.Getenv("APPDATA"), "thymer-desktop")
	default:
		home, _ := os.UserHomeDir()
		configDir = filepath.Join(home, ".config", "thymer-desktop")
	}
	return configDir
}

func getConfigPath() string {
	return filepath.Join(getConfigDir(), "config.json")
}

func loadConfigFile() (*Config, error) {
	configPath := getConfigPath()
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func saveConfigFile(config *Config) error {
	configDir := getConfigDir()
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(getConfigPath(), data, 0644)
}

func runConfigShow(cmd *cobra.Command, args []string) {
	config, err := loadConfigFile()
	if err != nil {
		exitError("Failed to load config: %v", err)
	}

	if config == nil {
		fmt.Println("No configuration found.")
		fmt.Println("\nRun 'thymer config set workspace <name>' to configure.")
		return
	}

	if jsonOutput {
		data, _ := json.MarshalIndent(config, "", "  ")
		fmt.Println(string(data))
		return
	}

	fmt.Println("Thymer Desktop Configuration")
	fmt.Println("=============================")
	fmt.Printf("Workspace:  %s\n", config.Workspace)
	fmt.Printf("Thymer URL: %s\n", config.ThymerURL)
	if config.LLMModel != "" {
		fmt.Printf("LLM Model:  %s\n", config.LLMModel)
	}
}

func runConfigSet(cmd *cobra.Command, args []string) {
	key := strings.ToLower(args[0])
	value := args[1]

	config, err := loadConfigFile()
	if err != nil {
		exitError("Failed to load config: %v", err)
	}
	if config == nil {
		config = &Config{}
	}

	switch key {
	case "workspace":
		workspace := strings.ToLower(strings.TrimSpace(value))
		config.Workspace = workspace
		config.ThymerURL = fmt.Sprintf("https://%s.thymer.com", workspace)
		fmt.Printf("Workspace set to: %s\n", workspace)
		fmt.Printf("Thymer URL: %s\n", config.ThymerURL)

	case "llmmodel", "llm-model", "model":
		config.LLMModel = value
		fmt.Printf("LLM model set to: %s\n", value)

	default:
		exitError("Unknown config key: %s\n\nAvailable keys: workspace, llmmodel", key)
	}

	if err := saveConfigFile(config); err != nil {
		exitError("Failed to save config: %v", err)
	}

	fmt.Printf("\nConfig saved to: %s\n", getConfigPath())
}

func runConfigPath(cmd *cobra.Command, args []string) {
	fmt.Println(getConfigPath())
}
