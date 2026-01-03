package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

type Config struct {
	Workspace string `json:"workspace"`
	Token     string `json:"token,omitempty"`
	path      string
}

func configDir() string {
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if configHome == "" {
		home, _ := os.UserHomeDir()
		configHome = filepath.Join(home, ".config")
	}
	return filepath.Join(configHome, "thymer-desktop")
}

func configPath() string {
	return filepath.Join(configDir(), "config.json")
}

func LoadConfig() *Config {
	cfg := &Config{
		path: configPath(),
	}

	data, err := os.ReadFile(cfg.path)
	if err != nil {
		return cfg
	}

	if err := json.Unmarshal(data, cfg); err != nil {
		log.Printf("[Config] Failed to parse config: %v", err)
	}

	return cfg
}

func (c *Config) Save() error {
	if err := os.MkdirAll(filepath.Dir(c.path), 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(c.path, data, 0600); err != nil {
		return err
	}

	log.Printf("[Config] Saved: %s", c.path)
	return nil
}

func (c *Config) ThymerURL() string {
	if c.Workspace == "" {
		return "https://app.thymer.com"
	}
	return "https://" + c.Workspace
}
